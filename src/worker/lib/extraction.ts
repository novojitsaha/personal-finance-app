// Pure helpers for statement extraction: output schema, validation, chunking,
// merging, reconciliation and dedupe hashing. No bindings used here, so it can
// be unit tested with plain Vitest (see extraction.test.ts).
import { z } from "zod";
import { CATEGORIES, type Category } from "../../shared/categories";

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const ExtractedTransaction = z.object({
	date: isoDate,
	description: z.string().trim().min(1),
	merchant: z.string().trim().nullable().optional().transform((s) => s || null),
	amount: z.number().finite(),
	currency: z.string().trim().length(3).toUpperCase().nullable().optional().transform((s) => s ?? null),
	/** Running balance printed after this transaction, if the statement has one. */
	balance: z.number().finite().nullable().optional().transform((n) => n ?? null),
});
export type ExtractedTransaction = z.infer<typeof ExtractedTransaction>;

export const ChunkExtraction = z.object({
	bank: z.string().trim().nullable().optional().transform((s) => s || null),
	account: z.string().trim().nullable().optional().transform((s) => s || null),
	currency: z.string().trim().length(3).toUpperCase().nullable().optional().transform((s) => s ?? null),
	period_start: isoDate.nullable().optional().transform((s) => s ?? null),
	period_end: isoDate.nullable().optional().transform((s) => s ?? null),
	opening_balance: z.number().finite().nullable().optional().transform((n) => n ?? null),
	closing_balance: z.number().finite().nullable().optional().transform((n) => n ?? null),
	transactions: z.array(ExtractedTransaction),
});
export type ChunkExtraction = z.infer<typeof ChunkExtraction>;

const nullable = (type: string) => ({ type: [type, "null"] });

export const StatementHeader = ChunkExtraction.omit({ transactions: true });
export type StatementHeader = z.infer<typeof StatementHeader>;

/**
 * JSON Schema handed to the model (`response_format: json_schema`). Written
 * by hand rather than generated so it only uses keywords that structured
 * output engines reliably support.
 */
export const CHUNK_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"bank",
		"account",
		"currency",
		"period_start",
		"period_end",
		"opening_balance",
		"closing_balance",
		"transactions",
	],
	properties: {
		bank: nullable("string"),
		account: nullable("string"),
		currency: nullable("string"),
		period_start: nullable("string"),
		period_end: nullable("string"),
		opening_balance: nullable("number"),
		closing_balance: nullable("number"),
		transactions: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["date", "description", "merchant", "amount", "currency", "balance"],
				properties: {
					date: { type: "string" },
					description: { type: "string" },
					merchant: nullable("string"),
					amount: { type: "number" },
					currency: nullable("string"),
					balance: nullable("number"),
				},
			},
		},
	},
} as const;

export const HEADER_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["bank", "account", "currency", "period_start", "period_end", "opening_balance", "closing_balance"],
	properties: Object.fromEntries(
		Object.entries(CHUNK_JSON_SCHEMA.properties).filter(([k]) => k !== "transactions"),
	),
} as const;

export function parseStatementHeader(raw: unknown): StatementHeader {
	const value = typeof raw === "string" ? JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) : raw;
	const result = StatementHeader.safeParse(value);
	if (!result.success) throw new Error(`Header failed validation: ${z.prettifyError(result.error).slice(0, 300)}`);
	return result.data;
}

/** Start and end of the statement, where the header and balances usually are. */
export function headerExcerpt(text: string, head = 6_000, tail = 3_000): string {
	if (text.length <= head + tail) return text;
	return `${text.slice(0, head)}\n\n[... transactions omitted ...]\n\n${text.slice(-tail)}`;
}

export function normalizeCategory(label: string): Category {
	const key = label.trim().toLowerCase().replace(/\band\b/g, "&").replace(/\s+/g, " ");
	return CATEGORIES.find((c) => c.toLowerCase() === key) ?? "Other";
}

/**
 * Parse a model reply into a validated chunk. Accepts an object or a JSON
 * string, optionally wrapped in a ```json fence. Throws on invalid output so
 * the Workflow step retries.
 */
export function parseChunkExtraction(raw: unknown): ChunkExtraction {
	let value = raw;
	if (typeof value === "string") {
		const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
		try {
			value = JSON.parse(text);
		} catch {
			throw new Error(`Model did not return valid JSON: ${text.slice(0, 200)}`);
		}
	}
	const result = ChunkExtraction.safeParse(value);
	if (!result.success) {
		throw new Error(`Model output failed validation: ${z.prettifyError(result.error).slice(0, 500)}`);
	}
	return result.data;
}

// ---------------------------------------------------------------------------
// Text handling
// ---------------------------------------------------------------------------

/**
 * Clean toMarkdown output before it goes to the model:
 * - drop the "## Metadata" block (producer, dates, PDF version), keeping only
 *   the page contents;
 * - PDF text extraction often glues a date heading onto the end of the
 *   previous line ("...HUUR2026-10-02"), which makes the model attach the date
 *   to the wrong row. Put such glued dates back on a line of their own.
 */
export function prepareStatementText(markdown: string): string {
	const contents = markdown.indexOf("## Contents");
	let text = contents >= 0 ? markdown.slice(contents + "## Contents".length) : markdown;
	// A date glued to a preceding letter or punctuation mark.
	text = text.replace(new RegExp(`([\\p{L}.)\\]])(${DATE})`, "gu"), "$1\n$2");
	// Distinctive dates (ISO, "Sep 9, 2026") glued to preceding digits, e.g. after an IBAN or amount.
	text = text.replace(new RegExp(`(\\d)(${ISO_DATE}|${MONTH_FIRST_DATE})`, "gu"), "$1\n$2");
	return text.trim();
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const ISO_DATE = "\\d{4}-\\d{2}-\\d{2}(?!\\d)"; // 2026-10-02
const MONTH_FIRST_DATE = `${MONTH} \\d{1,2}, \\d{4}`; // Sep 9, 2026
const DATE = [
	ISO_DATE,
	"\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}", // 02-10-2026, 2/10/2026, 02.10.2026
	`\\d{1,2} ${MONTH} \\d{4}`, // 2 Oct 2026
	MONTH_FIRST_DATE,
].join("|");
const STARTS_WITH_DATE = new RegExp(`^\\s*(?:${DATE})`, "u");
const HAS_DATE = new RegExp(DATE, "u");
const HAS_AMOUNT = /\d[.,]\d{2}(?!\d)/;

/**
 * Does this text look like it contains transactions (several lines with a
 * date and an amount)? Used to reject an empty model answer for such text.
 */
export function looksLikeTransactions(text: string): boolean {
	const lines = text.split("\n");
	let rows = 0;
	for (let i = 0; i < lines.length; i++) {
		const window = lines.slice(i, i + 3).join(" ");
		if (HAS_DATE.test(lines[i]) && HAS_AMOUNT.test(window)) rows++;
	}
	return rows >= 2;
}

/**
 * A lower bound on the number of transactions in the text: lines that start
 * with a date and have an amount before the next dated line (within 3 lines).
 * Layouts grouped under one date heading count once per heading, so this
 * undercounts there, which is fine for a lower bound.
 */
export function minimumTransactionRows(text: string): number {
	const lines = text.split("\n");
	let rows = 0;
	for (let i = 0; i < lines.length; i++) {
		if (!STARTS_WITH_DATE.test(lines[i])) continue;
		const rest = lines[i].replace(STARTS_WITH_DATE, "");
		let block = rest;
		for (let j = i + 1; j < Math.min(lines.length, i + 4) && !STARTS_WITH_DATE.test(lines[j]); j++) block += " " + lines[j];
		if (HAS_AMOUNT.test(block)) rows++;
	}
	return rows;
}

/**
 * Rough check whether the PDF has a real text layer. Scanned PDFs come back
 * (nearly) empty, or only with image placeholders. Expects prepared text.
 */
export function hasUsableText(text: string): boolean {
	const stripped = text
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "") // image links
		.replace(/^#+ .*$/gm, "") // headings like "### Page 1"
		.replace(/[#*_|`>-]/g, "");
	const alnum = stripped.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
	const digits = stripped.match(/\d/g)?.length ?? 0;
	return alnum >= 200 && digits >= 30;
}

/**
 * Split text into chunks of at most `maxChars`, on line boundaries, so each
 * model call stays small and fast. Where possible a chunk ends just before a
 * line that starts with a date (usually the start of a transaction), so
 * multi-line transactions aren't cut in half.
 */
export function chunkText(text: string, maxChars: number): string[] {
	const lines = text.split("\n").flatMap((line) =>
		line.length > maxChars ? line.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, "g"))! : [line],
	);
	const chunks: string[] = [];
	let current: string[] = [];
	let size = 0;
	for (const line of lines) {
		if (size + line.length + 1 > maxChars && current.length > 0) {
			// Back up to the last line that starts a dated row, if it's in the
			// second half of the chunk; carry the rest over to the next chunk.
			let cut = current.length;
			for (let i = current.length - 1; i > 0; i--) {
				if (STARTS_WITH_DATE.test(current[i])) {
					if (current.slice(0, i).join("\n").length >= maxChars / 2) cut = i;
					break;
				}
			}
			chunks.push(current.slice(0, cut).join("\n"));
			current = current.slice(cut);
			size = current.join("\n").length;
		}
		current.push(line);
		size += line.length + 1;
	}
	const rest = current.join("\n");
	if (rest.trim()) chunks.push(rest);
	return chunks;
}

// ---------------------------------------------------------------------------
// Merging, reconciliation, dedupe
// ---------------------------------------------------------------------------

export interface StatementExtraction {
	bank: string | null;
	account: string | null;
	currency: string | null;
	period_start: string | null;
	period_end: string | null;
	opening_balance: number | null;
	closing_balance: number | null;
	transactions: (ExtractedTransaction & { currency: string })[];
}

/** Merge per-chunk results in document order. */
export function mergeChunks(chunks: ChunkExtraction[], header?: StatementHeader | null): StatementExtraction {
	// The dedicated header extraction wins; per-chunk header fields are a fallback.
	const pick = (k: keyof StatementHeader, from: ChunkExtraction[]) =>
		header?.[k] ?? from.map((c) => c[k]).find((v) => v !== null && v !== undefined) ?? null;
	const first = (k: keyof StatementHeader) => pick(k, chunks);
	const last = (k: keyof StatementHeader) => pick(k, [...chunks].reverse());

	const currency = (first("currency") as string | null) ?? null;
	const transactions = chunks.flatMap((c) => c.transactions).map((t) => ({
		...t,
		amount: round2(t.amount),
		currency: t.currency ?? currency ?? "EUR",
	}));
	const opening = first("opening_balance") as number | null;
	fixSignsFromRunningBalance(transactions, opening);
	const dates = transactions.map((t) => t.date).sort();
	return {
		bank: first("bank") as string | null,
		account: first("account") as string | null,
		currency,
		// The model's period, widened to cover every transaction date (it can
		// pick up the wrong header date on unfamiliar layouts).
		period_start: minDate(first("period_start") as string | null, dates[0] ?? null),
		period_end: maxDate(last("period_end") as string | null, dates.at(-1) ?? null),
		opening_balance: opening,
		closing_balance: last("closing_balance") as number | null,
		transactions,
	};
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

const minDate = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : (a ?? b));
const maxDate = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/**
 * PDF text extraction often loses which column an amount was in ("Money out"
 * vs "Money in"), so the model can get the sign wrong. When the statement
 * prints a running balance, the change in balance tells us the true sign:
 * if |balance - previous balance| equals |amount| but the sign differs, flip
 * it. Only rows with a known previous balance are touched. Mutates in place
 * and returns the number of corrected signs.
 */
export function fixSignsFromRunningBalance(
	transactions: { amount: number; balance: number | null }[],
	opening: number | null,
): number {
	let fixed = 0;
	let previous = opening;
	for (const t of transactions) {
		if (t.balance === null) {
			previous = null;
			continue;
		}
		if (previous !== null) {
			const delta = round2(t.balance - previous);
			if (Math.abs(Math.abs(delta) - Math.abs(t.amount)) < 0.005 && Math.sign(delta) !== Math.sign(t.amount) && delta !== 0) {
				t.amount = -t.amount;
				fixed++;
			}
		}
		previous = t.balance;
	}
	return fixed;
}

/**
 * If the statement shows opening and closing balances, check that
 * opening + sum(transactions) = closing. Returns a warning message or null.
 */
export function reconcile(s: Pick<StatementExtraction, "opening_balance" | "closing_balance" | "transactions">): string | null {
	if (s.opening_balance === null || s.closing_balance === null) return null;
	const sum = s.transactions.reduce((acc, t) => acc + t.amount, 0);
	const expected = round2(s.opening_balance + sum);
	const diff = round2(s.closing_balance - expected);
	if (Math.abs(diff) < 0.01) return null;
	return (
		`Balances don't reconcile: opening ${s.opening_balance.toFixed(2)} + transactions ${round2(sum).toFixed(2)} ` +
		`= ${expected.toFixed(2)}, but the statement's closing balance is ${s.closing_balance.toFixed(2)} ` +
		`(difference ${diff.toFixed(2)}). Some transactions may be missing or misread.`
	);
}

/** Lowercase, strip punctuation and collapse whitespace. */
export function normalizeDescription(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

export function normalizeAccount(s: string | null): string {
	return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function sha256(text: string): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * dedupe_hash = sha256(account | date | amount | n), where n counts earlier
 * transactions with the same account, date and amount in the same statement.
 *
 * The description is deliberately left out: it is retyped by the model on
 * every run (sometimes with the merchant name in front, sometimes with a
 * reference number), so including it made re-uploading the same statement
 * insert duplicates. The occurrence index keeps genuinely identical payments
 * on one day (two coffees) apart, while the same transactions in an
 * overlapping statement hash to the same values and are skipped.
 */
export async function dedupeHashes(
	account: string | null,
	transactions: Pick<ExtractedTransaction, "date" | "amount">[],
): Promise<string[]> {
	const acct = normalizeAccount(account);
	const seen = new Map<string, number>();
	return Promise.all(
		transactions.map((t) => {
			const base = [acct, t.date, round2(t.amount).toFixed(2)].join("|");
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			return sha256(`${base}|${n}`);
		}),
	);
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

/**
 * Categories are assigned in a separate, small model call per batch of unique
 * counterparties rather than inside the big extraction output: that is more
 * consistent (the same merchant always gets the same category), cheaper
 * (each merchant is classified once) and can afford more reasoning.
 */
export interface CategorizeItem {
	id: number;
	merchant: string;
	example_description: string;
	direction: "money in" | "money out";
	count: number;
}

/** Group transactions by counterparty and direction. */
export function categorizeItems(transactions: Pick<ExtractedTransaction, "merchant" | "description" | "amount">[]): {
	items: CategorizeItem[];
	itemOf: number[];
} {
	const byKey = new Map<string, CategorizeItem>();
	const itemOf = transactions.map((t) => {
		const name = t.merchant || t.description;
		const direction = t.amount < 0 ? "money out" : "money in";
		const key = `${normalizeDescription(name)}|${direction}`;
		let item = byKey.get(key);
		if (!item) {
			item = { id: byKey.size, merchant: name, example_description: t.description.slice(0, 120), direction, count: 0 };
			byKey.set(key, item);
		}
		item.count++;
		return item.id;
	});
	return { items: [...byKey.values()], itemOf };
}

export const CATEGORIZE_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["categories"],
	properties: {
		categories: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "category"],
				properties: {
					id: { type: "integer" },
					category: { type: "string", enum: [...CATEGORIES] },
				},
			},
		},
	},
} as const;

const CategorizeResult = z.object({
	categories: z.array(z.object({ id: z.number().int(), category: z.string().transform(normalizeCategory) })),
});

/**
 * Parse a categorization reply. Throws (so the step retries) unless every
 * requested id got a category.
 */
export function parseCategorization(raw: unknown, ids: number[]): Record<number, Category> {
	const value = typeof raw === "string" ? JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) : raw;
	const result = CategorizeResult.safeParse(value);
	if (!result.success) throw new Error(`Categorization failed validation: ${z.prettifyError(result.error).slice(0, 300)}`);
	const map: Record<number, Category> = {};
	for (const { id, category } of result.data.categories) map[id] = category;
	const missing = ids.filter((id) => !(id in map));
	if (missing.length) throw new Error(`Categorization missed ${missing.length} of ${ids.length} items`);
	return map;
}
