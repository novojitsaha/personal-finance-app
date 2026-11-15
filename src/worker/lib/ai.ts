// Workers AI calls: structured extraction from statement text,
// categorization of counterparties, and page transcription with a vision
// model for scanned PDFs.
import { CATEGORIES, type Category } from "../../shared/categories";
import {
	CATEGORIZE_JSON_SCHEMA,
	CHUNK_JSON_SCHEMA,
	HEADER_JSON_SCHEMA,
	type CategorizeItem,
	type ChunkExtraction,
	type StatementHeader,
	looksLikeTransactions,
	minimumTransactionRows,
	parseCategorization,
	parseChunkExtraction,
	parseStatementHeader,
} from "./extraction";

/**
 * Text model for structured extraction. gpt-oss-120b: 128k context, strong
 * instruction following, supports `response_format: json_schema`, and is far
 * cheaper per output token than llama-3.3-70b (68k vs 205k neurons per M), which
 * matters because the output (every transaction as JSON) is the bulk of the cost.
 */
export const EXTRACTION_MODEL = "@cf/openai/gpt-oss-120b" as const;

/** Items per categorization call. */
export const CATEGORIZE_BATCH = 60;

/** Vision model to transcribe scanned pages (accepts base64 data-URL images). */
export const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct" as const;

/**
 * ~2-3k tokens of statement text per call (roughly 25-40 transactions). The
 * model reasons before answering, and on long inputs that took ~4 minutes and
 * hit the Workers AI request timeout; small chunks run in parallel instead.
 */
export const CHUNK_CHARS = 8_000;

export type ReasoningEffort = "low" | "medium" | "high";

const GUIDANCE = `supermarkets, butchers, greengrocers, markets -> Groceries; cafes, bakeries, snack bars -> Coffee & Snacks; restaurants and food delivery -> Restaurants; clothing, shoes and fashion stores (including fashion chains) -> Clothing & Fashion; department stores, online marketplaces, electronics, home goods, drugstores -> Shopping; bars, pubs, clubs (in Dutch and Belgian statements "café" or "cafe" usually means a pub) -> Bars & Nightlife; trains, public transport, taxis, ride hailing, fuel, parking -> Transport; flights, hotels, holiday rentals -> Travel; rent, mortgage, housing association -> Rent & Housing; energy, water, internet, mobile phone -> Utilities; streaming, software, cloud hosting, email, AI tools, news and other online services -> Subscriptions; gym, sports clubs and courts, pharmacy, doctor, health insurance, hairdressers and personal care -> Health & Fitness; cinema, concerts, games, events -> Entertainment; courses, books for study, tuition -> Education; charities, gifts -> Gifts & Donations; bank fees, interest charged, penalties -> Fees & Charges; moves between the holder's own accounts, savings transfers, and payments to or from other people (peer-to-peer payments and payment requests such as Tikkie, PayPal or Revolut transfers to friends, even when the description mentions what it was for) -> Transfers; salary, wages, benefits, interest received, tax refunds -> Income; anything else -> Other.`;

const SYSTEM_PROMPT = `You extract transactions from bank statements. The statement can be from any bank, in any language and layout (tables, grouped by date, multi-line entries). Return JSON that matches the schema exactly.

Rules:
- Include every transaction (every booked payment, card purchase, transfer, direct debit, fee, interest, salary...) exactly once, in document order. Do not skip any and do not invent any.
- Do NOT include balance lines, running balances, subtotals, "carried forward", summary boxes (opening/closing balance, total money in/out) or page headers as transactions.
- amount is signed: negative for money leaving the account (debit, "Af", "Money out", "-"), positive for money coming in (credit, "Bij", "Money in", "+"). Use the column the amount appears in or the debit/credit marker to decide the sign. The text was extracted from a PDF, so column positions may be lost and empty cells disappear; if there is a running balance column, the sign is the direction the balance moved (balance went down = negative). Use a dot as decimal separator and no thousands separators (e.g. "2.480,15" in a Dutch or German statement is 2480.15).
- date: the booking/transaction date as YYYY-MM-DD. Use the statement period to fill in a missing year. In layouts grouped by date, a date heading applies to the transactions listed after it, up to the next date heading.
- description: the transaction text as printed (counterparty and reference), on one line, without the amount or balance.
- merchant: a short, clean counterparty name a person would recognise ("REWE MARKT GMBH 0815 KOELN" -> "REWE", "LYFT *RIDE SUN 9AM" -> "Lyft"). null if unclear.
- currency: 3-letter ISO code of the amount; null if it is the account currency and not shown.
- balance: the running balance printed on the same row after this transaction, if the statement has a balance column; otherwise null.
- bank, account (IBAN or account name/number), currency, period_start, period_end, opening_balance, closing_balance: fill these in if this part of the statement shows them, otherwise null. If the bank name isn't printed, infer it from the account's IBAN bank code or the BIC. PDF text can put a block of labels first and their values after it in the same order (e.g. four labels "starting balance, ending balance, total in, total out" followed by four amounts); pair them up by position. You may be given only part of a long statement; that is fine.`;

const CATEGORIZE_PROMPT = `You categorize bank transactions for a personal finance app. You get a JSON list of counterparties from one person's bank statement, each with an id, the counterparty name, an example transaction description, whether the money went out or came in, and how many transactions there were. Return one category per id, chosen from: ${CATEGORIES.join(", ")}.

Guidance: ${GUIDANCE}

Money coming in is usually Income (salary, refunds, interest) or Transfers (from own accounts or other people); purchases and bills are never Income. A refund from a shop keeps the shop's category. Use Other only when nothing fits.`;

type Message = { role: "system" | "user"; content: string };

/**
 * Extract one chunk of statement text. Throws when the model returns invalid
 * or schema-violating output, so the calling Workflow step retries.
 */
export async function extractChunk(
	ai: Ai,
	text: string,
	part: { index: number; total: number },
	effort: ReasoningEffort = "low",
	checkCompleteness = true,
): Promise<ChunkExtraction> {
	const messages: Message[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{
			role: "user",
			content:
				(part.total > 1
					? `This is part ${part.index + 1} of ${part.total} of the statement. Extract only the transactions in this part.\n\n`
					: "") + `Statement text:\n\n${text}`,
		},
	];
	const result = await ai.run(EXTRACTION_MODEL, {
		messages,
		response_format: {
			type: "json_schema",
			json_schema: { name: "statement_extraction", schema: CHUNK_JSON_SCHEMA as unknown as Record<string, unknown>, strict: true },
		},
		reasoning_effort: effort,
		max_tokens: 16_000,
		temperature: 0,
	});
	const content = "choices" in result ? result.choices?.[0]?.message?.content : undefined;
	if (!content) throw new Error(`Empty response from ${EXTRACTION_MODEL}`);
	const extraction = parseChunkExtraction(content);
	// Seen with low reasoning effort on dense layouts: an empty or short answer
	// for text that clearly has more transactions. Throw so the step retries
	// (with more effort, see the Workflow).
	if (extraction.transactions.length === 0 && looksLikeTransactions(text)) {
		throw new Error("The model returned no transactions for a part of the statement that contains some.");
	}
	// Allow ~10% slack: a dated non-transaction line (e.g. "01-10-2026 Opening
	// balance 100,00") would otherwise reject a correct answer.
	const minimum = Math.floor(minimumTransactionRows(text) * 0.9) - 1;
	if (checkCompleteness && extraction.transactions.length < minimum) {
		throw new Error(`The model returned ${extraction.transactions.length} transactions for a part of the statement that has at least ${minimum}.`);
	}
	return extraction;
}

const HEADER_PROMPT = `You read the header and summary of a bank statement (any bank, language or layout). Return JSON with: bank (name of the bank; if not printed, infer it from the IBAN bank code or the BIC), account (the statement's own IBAN or account number/name, not a counterparty's), currency (3-letter ISO code), period_start and period_end (YYYY-MM-DD), opening_balance and closing_balance (signed numbers, dot as decimal separator, no thousands separators). Use null for anything not shown.
PDF text extraction can separate labels from values: a block of labels (e.g. "starting balance", "ending balance", "total in", "total out") may be followed by a block of amounts in the same order; pair them up by position. Opening balance is the balance at the start of the period, closing balance at the end. Do not use totals of money in or out as balances.`;

/** Extract statement-level fields from the start and end of the statement. */
export async function extractHeader(ai: Ai, excerpt: string, effort: ReasoningEffort = "medium"): Promise<StatementHeader> {
	const result = await ai.run(EXTRACTION_MODEL, {
		messages: [
			{ role: "system", content: HEADER_PROMPT },
			{ role: "user", content: `Statement text:\n\n${excerpt}` },
		],
		response_format: {
			type: "json_schema",
			json_schema: { name: "statement_header", schema: HEADER_JSON_SCHEMA as unknown as Record<string, unknown>, strict: true },
		},
		reasoning_effort: effort,
		max_tokens: 4_000,
		temperature: 0,
	});
	const content = "choices" in result ? result.choices?.[0]?.message?.content : undefined;
	if (!content) throw new Error(`Empty header response from ${EXTRACTION_MODEL}`);
	return parseStatementHeader(content);
}

/**
 * Categorize a batch of unique counterparties. Throws (so the step retries)
 * on invalid output or when an id is missing.
 */
export async function categorize(ai: Ai, items: CategorizeItem[], effort: ReasoningEffort = "medium"): Promise<Record<number, Category>> {
	const result = await ai.run(EXTRACTION_MODEL, {
		messages: [
			{ role: "system", content: CATEGORIZE_PROMPT },
			{ role: "user", content: JSON.stringify(items) },
		],
		response_format: {
			type: "json_schema",
			json_schema: { name: "categories", schema: CATEGORIZE_JSON_SCHEMA as unknown as Record<string, unknown>, strict: true },
		},
		reasoning_effort: effort,
		max_tokens: 8_000,
		temperature: 0,
	});
	const content = "choices" in result ? result.choices?.[0]?.message?.content : undefined;
	if (!content) throw new Error(`Empty categorization response from ${EXTRACTION_MODEL}`);
	return parseCategorization(content, items.map((i) => i.id));
}

const VISION_PROMPT = `This image is one page of a bank statement. Transcribe ALL text on the page as plain text, top to bottom. Put each table row or transaction on its own line and keep the columns in order separated by " | ". Copy dates, descriptions and amounts exactly as printed, including minus/plus signs, currency symbols, and decimal commas or points. Keep column headers (e.g. "Money out", "Money in", "Debit", "Credit", "Af/Bij") so it is clear which column an amount is in. Do not summarise, translate or add anything.`;

/** Transcribe a page image (JPEG/PNG) to text with the vision model. */
export async function transcribePage(ai: Ai, image: ArrayBuffer, mime: string): Promise<string> {
	const dataUrl = `data:${mime};base64,${toBase64(image)}`;
	const result = await ai.run(VISION_MODEL, {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: VISION_PROMPT },
					{ type: "image_url", image_url: { url: dataUrl } },
				],
			},
		],
		max_tokens: 4096,
		temperature: 0,
	});
	const text = typeof result.response === "string" ? result.response : JSON.stringify(result.response ?? "");
	if (!text.trim()) throw new Error(`Empty transcription from ${VISION_MODEL}`);
	return text;
}

function toBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}
