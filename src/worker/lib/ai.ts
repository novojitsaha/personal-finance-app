// Workers AI calls. One multimodal model does all the AI work: reading
// scanned pages, extracting transactions and the statement header, and
// categorizing counterparties. Text PDFs are converted with toMarkdown first
// (not a model, and free); scans are rendered to images in the browser.
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
 * DeepSeek V4.1 Flash: reads images and text, 1M-token context, JSON-schema
 * output, adjustable reasoning. $0.30 per M input and $1.20 per M output tokens
 * (Workers Paid only).
 */
export const MODEL = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";

/** Reasoning levels the model supports. */
export type ReasoningEffort = "none" | "low" | "high" | "max";

/**
 * Reasoning effort per task, by attempt (the last entry repeats). Extraction
 * alternates: a short answer benefits from more reasoning, but the model can
 * also reason in circles until it hits the output limit, which less reasoning
 * fixes. So: low, then none, then high.
 */
const EFFORT = {
	chunk: ["low", "none", "high"],
	header: ["low", "high"],
	categorize: ["low", "high"],
	transcribe: ["low", "high"],
} as const satisfies Record<string, readonly ReasoningEffort[]>;
const effortFor = (task: keyof typeof EFFORT, attempt: number): ReasoningEffort => {
	const steps: readonly ReasoningEffort[] = EFFORT[task];
	return steps[Math.min(attempt, steps.length) - 1];
};

/**
 * ~1.5-2k tokens of statement text per call (roughly 20-45 transactions), run
 * in parallel: long inputs with reasoning took minutes, and dense multi-line
 * layouts sometimes made the model reason until it hit the output limit.
 */
export const CHUNK_CHARS = 6_000;

/** Items per categorization call. */
export const CATEGORIZE_BATCH = 60;

const GUIDANCE = `supermarkets, butchers, greengrocers, markets -> Groceries; cafes, bakeries, snack bars -> Coffee & Snacks; restaurants and food delivery -> Restaurants; clothing, shoes and fashion stores (including fashion chains) -> Clothing & Fashion; department stores, online marketplaces, electronics, home goods, drugstores -> Shopping; bars, pubs, clubs (in Dutch and Belgian statements "café" or "cafe" usually means a pub) -> Bars & Nightlife; trains, public transport, taxis, ride hailing, fuel, parking -> Transport; flights, hotels, holiday rentals -> Travel; rent, mortgage, housing association -> Rent & Housing; energy, water, internet, mobile phone -> Utilities; streaming, software, cloud hosting, email, AI tools, news and other online services -> Subscriptions; gym, sports clubs and courts, pharmacy, doctor, health insurance, hairdressers and personal care -> Health & Fitness; cinema, concerts, games, events -> Entertainment; courses, books for study, tuition -> Education; charities, gifts -> Gifts & Donations; bank fees, interest charged, penalties -> Fees & Charges; moves between the holder's own accounts, savings transfers, and payments to or from other people (peer-to-peer payments and payment requests such as Tikkie, PayPal or Revolut transfers to friends, even when the description mentions what it was for) -> Transfers; salary, wages, benefits, interest received, tax refunds -> Income; anything else -> Other.`;

const SYSTEM_PROMPT = `You extract transactions from bank statements. The statement can be from any bank, in any language and layout (tables, grouped by date, multi-line entries). Return JSON that matches the schema exactly.

Rules:
- Include every transaction (every booked payment, card purchase, transfer, direct debit, fee, interest, salary...) exactly once, in document order. Do not skip any and do not invent any.
- Do NOT include balance lines, running balances, subtotals, "carried forward", summary boxes (opening/closing balance, total money in/out) or page headers as transactions.
- amount is signed: negative for money leaving the account (debit, "Af", "Money out", "-"), positive for money coming in (credit, "Bij", "Money in", "+"). Use the column the amount appears in or the debit/credit marker to decide the sign. The text was extracted from a PDF, so column positions may be lost and empty cells disappear; if there is a running balance column, the sign is the direction the balance moved (balance went down = negative). Use a dot as decimal separator and no thousands separators (e.g. "2.480,15" in a Dutch or German statement is 2480.15).
- date: the booking/transaction date as YYYY-MM-DD. Use the statement period to fill in a missing year. In layouts grouped by date, a date heading applies to the transactions listed after it, up to the next date heading.
- description: the transaction text as printed (counterparty and reference), on one line, without the amount or balance.
- merchant: a short, clean counterparty name a person would recognise ("REWE MARKT GMBH 0815 KOELN" -> "REWE", "LYFT *RIDE SUN 9AM" -> "Lyft"). For chains use the parent brand's full name, without store numbers, locations, payment-processor prefixes or sub-brand suffixes, so every branch and format of a chain gets the same name (e.g. "AH 1234", "AH to go Centraal" and "Albert Heijn XL" are all "Albert Heijn"; "NS GROEP IZ NS REIZIGERS" is "NS"; "SumUp *Bakkerij Jansen" is "Bakkerij Jansen"). null if unclear.
- currency: 3-letter ISO code of the amount; null if it is the account currency and not shown.
- balance: the running balance printed on the same row after this transaction, if the statement has a balance column; otherwise null.
- bank, account (IBAN or account name/number), currency, period_start, period_end, opening_balance, closing_balance: fill these in if this part of the statement shows them, otherwise null. If the bank name isn't printed, infer it from the account's IBAN bank code or the BIC. PDF text can put a block of labels first and their values after it in the same order (e.g. four labels "starting balance, ending balance, total in, total out" followed by four amounts); pair them up by position. You may be given only part of a long statement; that is fine.`;

const CATEGORIZE_PROMPT = `You categorize bank transactions for a personal finance app. You get a JSON list of counterparties from one person's bank statement, each with an id, the counterparty name, an example transaction description, whether the money went out or came in, and how many transactions there were. Return one category per id, chosen from: ${CATEGORIES.join(", ")}.

Guidance: ${GUIDANCE}

Money coming in is usually Income (salary, interest, cashback and bank rewards, insurance payouts, deposit refunds, tax refunds) or Transfers (from own accounts or other people); purchases and bills are never Income. A refund from a shop keeps the shop's category. Use Other only when nothing fits.`;

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Message = { role: "system" | "user"; content: string | ContentPart[] };

/**
 * Call the model and return the text of its answer. With a schema, the
 * answer is constrained to JSON matching it. Token usage is logged, so cost
 * can be checked in Workers observability.
 */
async function run(
	ai: Ai,
	task: string,
	messages: Message[],
	opts: { effort: ReasoningEffort; maxTokens: number; schema?: { name: string; schema: object } },
): Promise<string> {
	const result = (await ai.run(MODEL, {
		messages,
		...(opts.schema && {
			response_format: { type: "json_schema", json_schema: { name: opts.schema.name, schema: opts.schema.schema, strict: true } },
		}),
		reasoning_effort: opts.effort,
		max_completion_tokens: opts.maxTokens,
		temperature: 0,
	})) as {
		choices?: { message?: { content?: unknown }; finish_reason?: string }[];
		response?: unknown;
		usage?: Record<string, unknown>;
	};
	console.log(JSON.stringify({ event: "ai_usage", task, model: MODEL, effort: opts.effort, usage: result.usage ?? null }));
	const content = result.choices?.[0]?.message?.content ?? result.response;
	const text = typeof content === "string" ? content : content == null ? "" : JSON.stringify(content);
	if (result.choices?.[0]?.finish_reason === "length") {
		throw new Error(`${MODEL} hit the output limit (${opts.maxTokens} tokens) before answering (${task}, reasoning ${opts.effort}).`);
	}
	if (!text.trim()) throw new Error(`Empty response from ${MODEL} (${task})`);
	return text;
}

/**
 * Extract one chunk of statement text. Throws when the model returns invalid,
 * schema-violating or clearly incomplete output, so the Workflow step retries
 * (with more reasoning effort).
 */
export async function extractChunk(
	ai: Ai,
	text: string,
	part: { index: number; total: number },
	attempt = 1,
	checkCompleteness = true,
): Promise<ChunkExtraction> {
	const content = await run(
		ai,
		"extract",
		[
			{ role: "system", content: SYSTEM_PROMPT },
			{
				role: "user",
				content:
					(part.total > 1
						? `This is part ${part.index + 1} of ${part.total} of the statement. Extract only the transactions in this part.\n\n`
						: "") + `Statement text:\n\n${text}`,
			},
		],
		{ effort: effortFor("chunk", attempt), maxTokens: 32_000, schema: { name: "statement_extraction", schema: CHUNK_JSON_SCHEMA } },
	);
	const extraction = parseChunkExtraction(content);
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
export async function extractHeader(ai: Ai, excerpt: string, attempt = 1): Promise<StatementHeader> {
	const content = await run(
		ai,
		"header",
		[
			{ role: "system", content: HEADER_PROMPT },
			{ role: "user", content: `Statement text:\n\n${excerpt}` },
		],
		{ effort: effortFor("header", attempt), maxTokens: 8_000, schema: { name: "statement_header", schema: HEADER_JSON_SCHEMA } },
	);
	return parseStatementHeader(content);
}

/**
 * Categorize a batch of unique counterparties. Throws (so the step retries)
 * on invalid output or when an id is missing.
 */
export async function categorize(ai: Ai, items: CategorizeItem[], attempt = 1): Promise<Record<number, Category>> {
	const content = await run(
		ai,
		"categorize",
		[
			{ role: "system", content: CATEGORIZE_PROMPT },
			{ role: "user", content: JSON.stringify(items) },
		],
		{ effort: effortFor("categorize", attempt), maxTokens: 16_000, schema: { name: "categories", schema: CATEGORIZE_JSON_SCHEMA } },
	);
	return parseCategorization(content, items.map((i) => i.id));
}

const TRANSCRIBE_PROMPT = `This image is one page of a bank statement. Transcribe ALL text on the page as plain text, top to bottom. Put each table row or transaction on its own line and keep the columns in order separated by " | ". Copy dates, descriptions and amounts exactly as printed, including minus/plus signs, currency symbols, and decimal commas or points. Keep column headers (e.g. "Money out", "Money in", "Debit", "Credit", "Af/Bij") so it is clear which column an amount is in. Do not summarise, translate or add anything.`;

/** Transcribe a scanned page image (JPEG/PNG) to text. */
export async function transcribePage(ai: Ai, image: ArrayBuffer, mime: string, attempt = 1): Promise<string> {
	return run(
		ai,
		"transcribe",
		[
			{
				role: "user",
				content: [
					{ type: "text", text: TRANSCRIBE_PROMPT },
					{ type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(image)}` } },
				],
			},
		],
		{ effort: effortFor("transcribe", attempt), maxTokens: 16_000 },
	);
}

function toBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}
