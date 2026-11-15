// Durable processing pipeline for an uploaded statement:
//   PDF in R2 -> text (toMarkdown, or vision model on page images for scans)
//   -> chunked structured extraction -> validate -> reconcile -> dedupe insert.
// Each step is retried independently; a failure after all retries marks the
// statement as failed with the error message.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { CATEGORIZE_BATCH, CHUNK_CHARS, MODEL, categorize, extractChunk, extractHeader, transcribePage } from "./lib/ai";
import type { Category } from "../shared/categories";
import {
	type ChunkExtraction,
	categorizeItems,
	chunkText,
	dedupeHashes,
	hasUsableText,
	headerExcerpt,
	mergeChunks,
	prepareStatementText,
	reconcile,
} from "./lib/extraction";

export interface StatementParams {
	statementId: string;
}

/** Max statement text we process (~100+ pages of a typical statement). */
const MAX_TEXT_CHARS = 400_000;

const AI_RETRY = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "5 minutes" } as const;
const DB_RETRY = { retries: { limit: 5, delay: "2 seconds", backoff: "exponential" }, timeout: "1 minute" } as const;

export class StatementWorkflow extends WorkflowEntrypoint<Env, StatementParams> {
	async run(event: WorkflowEvent<StatementParams>, step: WorkflowStep) {
		const { statementId } = event.payload;
		try {
			await this.process(statementId, step);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await step.do("mark failed", DB_RETRY, async () => {
				await this.env.DB.prepare(
					"UPDATE statements SET status = 'failed', error = ?, processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
				)
					.bind(message.slice(0, 2000), statementId)
					.run();
			});
			throw err;
		}
	}

	private async process(statementId: string, step: WorkflowStep) {
		const statement = await step.do("mark processing", DB_RETRY, async () => {
			const row = await this.env.DB.prepare(
				"UPDATE statements SET status = 'processing', error = NULL, warning = NULL WHERE id = ? RETURNING r2_key, filename",
			)
				.bind(statementId)
				.first<{ r2_key: string; filename: string }>();
			if (!row) throw new Error(`Statement ${statementId} not found`);
			return row;
		});

		// 1. Text layer via Workers AI Markdown conversion.
		const markdown = await step.do("convert pdf to markdown", AI_RETRY, async () => {
			const obj = await this.env.STATEMENTS.get(statement.r2_key);
			if (!obj) throw new Error(`PDF missing from R2: ${statement.r2_key}`);
			const blob = new Blob([await obj.arrayBuffer()], { type: "application/pdf" });
			const result = await this.env.AI.toMarkdown({ name: statement.filename, blob });
			if (result.format === "error") throw new Error(`PDF conversion failed: ${result.error}`);
			return result.data.slice(0, MAX_TEXT_CHARS + 1);
		});
		if (markdown.length > MAX_TEXT_CHARS) {
			throw new Error(`Statement is too long to process (over ${MAX_TEXT_CHARS.toLocaleString()} characters of text).`);
		}

		// 2. Scanned PDF? Fall back to transcribing the page images the browser
		//    rendered at upload time.
		let text = prepareStatementText(markdown);
		let method: "text" | "vision" = "text";
		if (!hasUsableText(text)) {
			const pageKeys = await step.do("list page images", DB_RETRY, async () => {
				const listed = await this.env.STATEMENTS.list({ prefix: `statements/${statementId}/page-` });
				return listed.objects.map((o) => o.key).sort((a, b) => pageNumber(a) - pageNumber(b));
			});
			if (pageKeys.length === 0) {
				throw new Error(
					"This PDF has no readable text layer (it looks scanned) and no page images were uploaded with it. " +
						"Upload it through the web app, which sends page images for OCR.",
				);
			}
			const pages: string[] = [];
			for (const [i, key] of pageKeys.entries()) {
				pages.push(
					await step.do(`transcribe page ${i + 1}`, AI_RETRY, async ({ attempt }) => {
						const obj = await this.env.STATEMENTS.get(key);
						if (!obj) throw new Error(`Page image missing from R2: ${key}`);
						return transcribePage(this.env.AI, await obj.arrayBuffer(), obj.httpMetadata?.contentType ?? "image/jpeg", attempt);
					}),
				);
			}
			text = pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join("\n\n");
			method = "vision";
		}

		// 3. Structured extraction: statement header plus one step per chunk,
		//    all in parallel; a retry uses more reasoning effort.
		const chunks = chunkText(text, CHUNK_CHARS);
		const [header, ...results] = await Promise.all([
			step
				.do("extract statement header", AI_RETRY, ({ attempt }) =>
					extractHeader(this.env.AI, headerExcerpt(text), attempt),
				)
				.catch(() => null), // optional: chunks carry header fields too
			...chunks.map((chunk, index) =>
				step.do(`extract transactions ${index + 1}/${chunks.length}`, AI_RETRY, ({ attempt }) =>
					// The last attempt accepts a short answer; reconciliation then flags it.
					extractChunk(this.env.AI, chunk, { index, total: chunks.length }, attempt, attempt <= AI_RETRY.retries.limit),
				),
			),
		]);
		const extraction = mergeChunks(results as ChunkExtraction[], header);
		if (extraction.transactions.length === 0) {
			throw new Error("No transactions were found in this statement.");
		}

		// 4. Categorize each unique counterparty once, in parallel batches.
		const { items, itemOf } = categorizeItems(extraction.transactions);
		const batches: (typeof items)[] = [];
		for (let i = 0; i < items.length; i += CATEGORIZE_BATCH) batches.push(items.slice(i, i + CATEGORIZE_BATCH));
		const categoryById: Record<number, Category> = Object.assign(
			{},
			...(await Promise.all(
				batches.map((batch, i) =>
					step.do(`categorize ${i + 1}/${batches.length}`, AI_RETRY, ({ attempt }) =>
						categorize(this.env.AI, batch, attempt),
					),
				),
			)),
		);
		const categories = itemOf.map((id) => categoryById[id] ?? "Other");

		// 5. Reconcile, dedupe and store.
		await step.do("save transactions", DB_RETRY, async () => {
			const warning = reconcile(extraction);
			const hashes = await dedupeHashes(extraction.account, extraction.transactions);
			const insert = this.env.DB.prepare(
				`INSERT INTO transactions (id, statement_id, date, description, merchant, amount, currency, category, category_source, dedupe_hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?)
				 ON CONFLICT (dedupe_hash) DO NOTHING`,
			);
			const inserts = extraction.transactions.map((t, i) =>
				insert.bind(crypto.randomUUID(), statementId, t.date, t.description, t.merchant, t.amount, t.currency, categories[i], hashes[i]),
			);
			// One batch = one transaction, so a retry never leaves a partial insert.
			// inserted_count is counted in SQL, so it stays right on retries too.
			const update = this.env.DB.prepare(
				`UPDATE statements SET status = 'done', error = NULL, warning = ?, bank = ?, account_iban_or_name = ?, currency = ?,
				   period_start = ?, period_end = ?, opening_balance = ?, closing_balance = ?, extraction_method = ?,
				   transaction_count = ?, inserted_count = (SELECT COUNT(*) FROM transactions WHERE statement_id = ?),
				   processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				 WHERE id = ?
				 RETURNING inserted_count`,
			).bind(
				warning,
				extraction.bank,
				extraction.account,
				extraction.currency,
				extraction.period_start,
				extraction.period_end,
				extraction.opening_balance,
				extraction.closing_balance,
				method,
				extraction.transactions.length,
				statementId,
				statementId,
			);
			const results = await this.env.DB.batch([...inserts, update]);
			const inserted = (results.at(-1)?.results?.[0] as { inserted_count: number } | undefined)?.inserted_count ?? 0;
			return { inserted, warning };
		});

		return { method, model: MODEL };
	}
}

function pageNumber(key: string): number {
	return Number(key.match(/page-(\d+)/)?.[1] ?? 0);
}
