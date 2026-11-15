import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Statement, StatementWithTransactions, Transaction } from "../../shared/api";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PAGE_IMAGES = 10;
const MAX_PAGE_IMAGE_BYTES = 3 * 1024 * 1024;

const STATEMENT_COLUMNS = `id, filename, size_bytes, page_count, bank, account_iban_or_name, currency, period_start, period_end,
	opening_balance, closing_balance, status, error, warning, extraction_method, transaction_count, inserted_count,
	(SELECT COUNT(*) FROM statement_transactions st
	   WHERE st.statement_id = statements.id
	     AND EXISTS (SELECT 1 FROM statement_transactions o WHERE o.transaction_id = st.transaction_id AND o.statement_id != statements.id)
	) AS shared_count,
	uploaded_at, processed_at`;

export const statements = new Hono<{ Bindings: Env }>();

/**
 * Upload a statement (multipart/form-data):
 *   file       the PDF (required, max 10 MB)
 *   page_count number of pages, as counted by the browser (optional)
 *   page       page images (JPEG/PNG) rendered by the browser, in order; only
 *              sent for PDFs without a text layer (scans). Max 10.
 */
statements.post(
	"/",
	bodyLimit({
		maxSize: MAX_PDF_BYTES + MAX_PAGE_IMAGES * MAX_PAGE_IMAGE_BYTES + 64 * 1024,
		onError: (c) => c.json({ error: "Upload is too large (max 10 MB per PDF)." }, 413),
	}),
	async (c) => {
		let form: FormData;
		try {
			form = await c.req.formData();
		} catch {
			return c.json({ error: "Expected a multipart/form-data upload." }, 400);
		}
		const file = form.get("file");
		if (!(file instanceof File)) return c.json({ error: "Missing 'file' field with the PDF." }, 400);
		if (file.size === 0) return c.json({ error: "The file is empty." }, 400);
		if (file.size > MAX_PDF_BYTES) return c.json({ error: "PDF is too large (max 10 MB)." }, 413);
		const pdf = await file.arrayBuffer();
		if (!isPdf(pdf)) return c.json({ error: `${file.name} is not a PDF.` }, 415);

		const pages = form.getAll("page").filter((p): p is File => p instanceof File);
		if (pages.length > MAX_PAGE_IMAGES) {
			return c.json({ error: `Scanned statements are limited to ${MAX_PAGE_IMAGES} pages.` }, 400);
		}
		for (const p of pages) {
			if (p.size > MAX_PAGE_IMAGE_BYTES || !imageType(new Uint8Array(await p.slice(0, 8).arrayBuffer()))) {
				return c.json({ error: "Invalid page image." }, 400);
			}
		}
		const pageCount = Number(form.get("page_count")) || null;

		const id = crypto.randomUUID();
		const r2Key = `statements/${id}.pdf`;
		const filename = file.name.slice(0, 255) || "statement.pdf";
		await c.env.STATEMENTS.put(r2Key, pdf, {
			httpMetadata: { contentType: "application/pdf" },
			customMetadata: { filename },
		});
		await Promise.all(
			pages.map(async (p, i) => {
				const bytes = await p.arrayBuffer();
				const type = imageType(new Uint8Array(bytes, 0, 8))!;
				await c.env.STATEMENTS.put(`statements/${id}/page-${i + 1}.${type === "image/png" ? "png" : "jpg"}`, bytes, {
					httpMetadata: { contentType: type },
				});
			}),
		);
		await c.env.DB.prepare(
			"INSERT INTO statements (id, r2_key, filename, size_bytes, page_count, status) VALUES (?, ?, ?, ?, ?, 'uploaded')",
		)
			.bind(id, r2Key, filename, file.size, pageCount)
			.run();
		await c.env.STATEMENT_WORKFLOW.create({ id, params: { statementId: id } });

		const row = await c.env.DB.prepare(`SELECT ${STATEMENT_COLUMNS} FROM statements WHERE id = ?`).bind(id).first<Statement>();
		return c.json(row, 202);
	},
);

statements.get("/", async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT ${STATEMENT_COLUMNS} FROM statements ORDER BY uploaded_at DESC LIMIT 500`,
	).all<Statement>();
	return c.json(results);
});

statements.get("/:id", async (c) => {
	const id = c.req.param("id");
	const [stmt, txs] = await c.env.DB.batch([
		c.env.DB.prepare(`SELECT ${STATEMENT_COLUMNS} FROM statements WHERE id = ?`).bind(id),
		// Via the link table: includes transactions first imported from an
		// overlapping statement.
		c.env.DB.prepare(
			`SELECT t.id, t.statement_id, t.date, t.description, t.merchant, t.amount, t.currency, t.category, t.category_source, t.is_recurring
			 FROM statement_transactions st JOIN transactions t ON t.id = st.transaction_id
			 WHERE st.statement_id = ? ORDER BY t.date, t.created_at, t.rowid`,
		).bind(id),
	]);
	const statement = stmt.results[0] as Statement | undefined;
	if (!statement) return c.json({ error: "Statement not found." }, 404);
	const body: StatementWithTransactions = { ...statement, transactions: txs.results as unknown as Transaction[] };
	return c.json(body);
});

statements.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const row = await c.env.DB.prepare("SELECT r2_key, status FROM statements WHERE id = ?")
		.bind(id)
		.first<{ r2_key: string; status: string }>();
	if (!row) return c.json({ error: "Statement not found." }, 404);

	// Stop processing first so it can't write transactions after the delete.
	if (row.status === "uploaded" || row.status === "processing") {
		try {
			await (await c.env.STATEMENT_WORKFLOW.get(id)).terminate();
		} catch {
			// Already finished or never started.
		}
	}
	const pageImages = await c.env.STATEMENTS.list({ prefix: `statements/${id}/` });
	await c.env.STATEMENTS.delete([row.r2_key, ...pageImages.objects.map((o) => o.key)]);
	// A transaction can belong to several overlapping statements. Only delete
	// the ones no other statement contains; the rest move to a remaining
	// statement (transactions.statement_id cascades on delete).
	const [, , deleted] = await c.env.DB.batch([
		c.env.DB.prepare("DELETE FROM statement_transactions WHERE statement_id = ?").bind(id),
		c.env.DB.prepare(
			`UPDATE transactions
			 SET statement_id = (SELECT MIN(st.statement_id) FROM statement_transactions st WHERE st.transaction_id = transactions.id)
			 WHERE statement_id = ? AND EXISTS (SELECT 1 FROM statement_transactions st WHERE st.transaction_id = transactions.id)`,
		).bind(id),
		c.env.DB.prepare("DELETE FROM transactions WHERE statement_id = ?").bind(id),
		c.env.DB.prepare("DELETE FROM statements WHERE id = ?").bind(id),
	]);
	return c.json({ deleted_transactions: deleted.meta.changes ?? 0 });
});

function isPdf(buf: ArrayBuffer): boolean {
	// "%PDF-" magic bytes, allowing for a little leading junk as PDF readers do.
	const head = new TextDecoder("latin1").decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)));
	return head.includes("%PDF-");
}

function imageType(b: Uint8Array): "image/jpeg" | "image/png" | null {
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
	return null;
}
