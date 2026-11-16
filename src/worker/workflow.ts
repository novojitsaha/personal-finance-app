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
	accountKey,
	normalizeAccount,
	overlapMatch,
	pairNearDuplicates,
	type StoredTransaction,
} from "./lib/extraction";
import { merchantKey } from "./lib/analytics";
import { type Alias, type VariantRule, resolveMerchants } from "./lib/merchants";

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

		// 4. Categories. The user's "always use this category for this merchant"
		//    overrides win; every other unique counterparty is categorized once
		//    by the model, in parallel batches.
		const fixed = await step.do("load category overrides", DB_RETRY, async () => {
			const [aliases, variants, overrides] = await this.env.DB.batch([
				this.env.DB.prepare("SELECT alias_key, canonical_key, canonical_name FROM merchant_aliases"),
				this.env.DB.prepare("SELECT variant_key, merchant_name FROM merchant_variant_rules"),
				this.env.DB.prepare("SELECT merchant_key, category FROM merchant_overrides"),
			]);
			// Resolve each new transaction's merchant the way the app shows it
			// (split variants, renames, merges), then look up the override.
			const resolved = resolveMerchants(
				extraction.transactions.map((t, i) => ({
					...t,
					id: String(i),
					statement_id: statementId,
					merchant_key: merchantKey(t.merchant, t.description),
					currency: t.currency,
					category: "Other" as Category,
					category_source: "ai" as const,
				})),
				aliases.results as unknown as Alias[],
				variants.results as unknown as VariantRule[],
			);
			const byKey = new Map((overrides.results as { merchant_key: string; category: Category }[]).map((o) => [o.merchant_key, o.category]));
			return resolved.map((t) => byKey.get(t.merchant_key) ?? null);
		});
		const toCategorize = extraction.transactions.filter((_, i) => !fixed[i]);
		const { items, itemOf } = categorizeItems(toCategorize);
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
		let next = 0;
		const categorized = extraction.transactions.map((_, i) => {
			const fixedCategory = fixed[i];
			return fixedCategory
				? { category: fixedCategory, source: "user" as const }
				: { category: categoryById[itemOf[next++]] ?? ("Other" as Category), source: "ai" as const };
		},
		);

		// 5. Which account is this? Normally the normalized account key. If no
		//    earlier statement has that key, but one from the same bank with an
		//    overlapping period contains (nearly) the same transactions, it's
		//    the same account read differently: use that statement's key.
		const periodStart = extraction.period_start ?? extraction.transactions[0].date;
		const periodEnd = extraction.period_end ?? extraction.transactions.at(-1)!.date;
		const key = await step.do("match account", DB_RETRY, async () => {
			const own = accountKey(extraction);
			const { results: candidates } = await this.env.DB.prepare(
				`SELECT id, account_key, bank, account_iban_or_name AS account, currency, period_start, period_end FROM statements
				 WHERE id != ? AND status = 'done' AND period_start <= ? AND period_end >= ?`,
			)
				.bind(statementId, periodEnd, periodStart)
				.all<{ id: string; account_key: string | null; bank: string | null; account: string | null; currency: string | null; period_start: string; period_end: string }>();
			const keyOf = (c: (typeof candidates)[number]) => c.account_key ?? accountKey(c);
			if (!candidates.length || candidates.some((c) => keyOf(c) === own)) return own;
			const bank = normalizeAccount(extraction.bank);
			for (const c of candidates.filter((c) => !bank || normalizeAccount(c.bank) === bank)) {
				const from = c.period_start > periodStart ? c.period_start : periodStart;
				const to = c.period_end < periodEnd ? c.period_end : periodEnd;
				const { results: theirs } = await this.env.DB.prepare(
					`SELECT t.date, t.amount FROM statement_transactions st JOIN transactions t ON t.id = st.transaction_id
					 WHERE st.statement_id = ? AND t.date BETWEEN ? AND ?`,
				)
					.bind(c.id, from, to)
					.all<{ date: string; amount: number }>();
				const m = overlapMatch(extraction.transactions, theirs, from, to);
				if (m.rows >= 5 && m.ratio >= 0.8) return keyOf(c);
			}
			return own;
		});

		// 6. Reconcile, dedupe and store.
		await step.do("save transactions", DB_RETRY, async () => {
			const warning = reconcile(extraction);
			const hashes = await dedupeHashes(key, extraction.transactions);
			// Stored transactions of this account around this period, for
			// near-duplicates (same payment, date read 1-2 days differently).
			const { results: stored } = await this.env.DB.prepare(
				`SELECT t.id, t.date, t.amount, t.dedupe_hash FROM transactions t
				 WHERE t.date BETWEEN date(?, '-2 days') AND date(?, '+2 days')
				   AND EXISTS (SELECT 1 FROM statement_transactions st JOIN statements s ON s.id = st.statement_id
				               WHERE st.transaction_id = t.id AND s.account_key = ? AND s.id != ?)`,
			)
				.bind(periodStart, periodEnd, key, statementId)
				.all<StoredTransaction>();
			const near = pairNearDuplicates(extraction.transactions, hashes, stored);
			const insert = this.env.DB.prepare(
				`INSERT INTO transactions (id, statement_id, date, description, merchant, amount, currency, category, category_source, dedupe_hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT (dedupe_hash) DO NOTHING`,
			);
			// Link this statement to each of its transactions, whether just
			// inserted or already stored from an overlapping statement.
			const link = this.env.DB.prepare(
				`INSERT OR IGNORE INTO statement_transactions (statement_id, transaction_id)
				 SELECT ?, id FROM transactions WHERE dedupe_hash = ?`,
			);
			const linkId = this.env.DB.prepare("INSERT OR IGNORE INTO statement_transactions (statement_id, transaction_id) VALUES (?, ?)");
			const inserts = extraction.transactions.flatMap((t, i) => {
				const twin = near.get(i);
				if (twin) return [linkId.bind(statementId, twin)];
				return [
					insert.bind(
						crypto.randomUUID(),
						statementId,
						t.date,
						t.description,
						t.merchant,
						t.amount,
						t.currency,
						categorized[i].category,
						categorized[i].source,
						hashes[i],
					),
					link.bind(statementId, hashes[i]),
				];
			});
			// One batch = one transaction, so a retry never leaves a partial insert.
			// inserted_count is counted in SQL, so it stays right on retries too.
			const update = this.env.DB.prepare(
				`UPDATE statements SET status = 'done', error = NULL, warning = ?, bank = ?, account_iban_or_name = ?, account_key = ?, currency = ?,
				   period_start = ?, period_end = ?, opening_balance = ?, closing_balance = ?, extraction_method = ?,
				   transaction_count = ?, inserted_count = (SELECT COUNT(*) FROM transactions WHERE statement_id = ?),
				   processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				 WHERE id = ?
				 RETURNING inserted_count`,
			).bind(
				warning,
				extraction.bank,
				extraction.account,
				key,
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
