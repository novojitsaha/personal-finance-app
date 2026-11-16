import { describe, expect, it } from "vitest";
import {
	accountKey,
	categorizeItems,
	chunkText,
	fixSignsFromRunningBalance,
	dedupeHashes,
	hasUsableText,
	looksLikeTransactions,
	minimumTransactionRows,
	mergeChunks,
	normalizeCategory,
	normalizeDescription,
	overlapMatch,
	pairNearDuplicates,
	parseCategorization,
	parseChunkExtraction,
	prepareStatementText,
	reconcile,
} from "./extraction";

const chunk = (over: Record<string, unknown> = {}) => ({
	bank: null,
	account: null,
	currency: null,
	period_start: null,
	period_end: null,
	opening_balance: null,
	closing_balance: null,
	transactions: [],
	...over,
});

describe("parseChunkExtraction", () => {
	it("accepts a JSON string, including a ```json fence", () => {
		const raw = "```json\n" + JSON.stringify(chunk({
			bank: "ING",
			currency: "eur",
			transactions: [{ date: "2026-09-01", description: "RENT", merchant: "", amount: -1250, currency: null, balance: null }],
		})) + "\n```";
		const out = parseChunkExtraction(raw);
		expect(out.currency).toBe("EUR");
		expect(out.transactions[0]).toMatchObject({ merchant: null, currency: null, balance: null });
	});

	it("rejects bad dates and non-JSON so the step retries", () => {
		expect(() => parseChunkExtraction("not json")).toThrow(/valid JSON/);
		expect(() =>
			parseChunkExtraction(chunk({
				transactions: [{ date: "01-09-2026", description: "X", merchant: null, amount: 1, currency: null, balance: null }],
			})),
		).toThrow(/validation/);
	});
});

describe("categorization", () => {
	it("groups transactions by counterparty and direction", () => {
		const { items, itemOf } = categorizeItems([
			{ merchant: "Albert Heijn", description: "AH 1234", amount: -10 },
			{ merchant: "albert heijn", description: "AH 99", amount: -5 },
			{ merchant: "Albert Heijn", description: "REFUND", amount: 5 },
			{ merchant: null, description: "SOME SHOP", amount: -1 },
		]);
		expect(itemOf).toEqual([0, 0, 1, 2]);
		expect(items.map((i) => [i.merchant, i.direction, i.count])).toEqual([
			["Albert Heijn", "money out", 2],
			["Albert Heijn", "money in", 1],
			["SOME SHOP", "money out", 1],
		]);
	});
	it("parses categories, maps unknown labels to Other, and requires every id", () => {
		expect(parseCategorization('{"categories":[{"id":0,"category":"groceries"},{"id":1,"category":"Pets"}]}', [0, 1])).toEqual({
			0: "Groceries",
			1: "Other",
		});
		expect(() => parseCategorization({ categories: [{ id: 0, category: "Income" }] }, [0, 1])).toThrow(/missed 1 of 2/);
	});
});

describe("mergeChunks", () => {
	it("takes header fields from the first chunk, closing balance from the last, and fills currency", () => {
		const merged = mergeChunks([
			parseChunkExtraction(chunk({
				bank: "ING", account: "NL91INGB0004386274", currency: "EUR", period_start: "2026-09-01", opening_balance: 100,
				transactions: [{ date: "2026-09-02", description: "A", merchant: "A", amount: -10.004, currency: null, balance: null }],
			})),
			parseChunkExtraction(chunk({
				closing_balance: 95, period_end: "2026-09-30",
				transactions: [{ date: "2026-09-03", description: "B", merchant: "B", amount: 5, currency: null, balance: null }],
			})),
		]);
		expect(merged).toMatchObject({ bank: "ING", opening_balance: 100, closing_balance: 95, period_end: "2026-09-30" });
		expect(merged.transactions.map((t) => [t.amount, t.currency])).toEqual([[-10, "EUR"], [5, "EUR"]]);
		expect(reconcile(merged)).toBeNull();
	});
});

describe("reconcile", () => {
	it("warns when transactions don't add up to the closing balance", () => {
		const warning = reconcile({ opening_balance: 100, closing_balance: 50, transactions: [{ amount: -40 }] as never });
		expect(warning).toMatch(/difference -10\.00/);
	});
	it("is silent without balances", () => {
		expect(reconcile({ opening_balance: null, closing_balance: 50, transactions: [] })).toBeNull();
	});
});

describe("dedupeHashes", () => {
	const tx = (amount = -4.6, date = "2026-09-15") => ({ date, amount });
	const ing = (account: string | null, bank: string | null = "ING", currency: string | null = "EUR") =>
		accountKey({ account, bank, currency });

	it("keeps identical transactions within one statement apart", async () => {
		const [a, b] = await dedupeHashes(ing("NL91 INGB 0004 3862 74"), [tx(), tx()]);
		expect(a).not.toBe(b);
	});

	it("matches the same transactions in an overlapping statement, however the account is printed", async () => {
		const first = await dedupeHashes(ing("NL91INGB0004386274"), [tx(), tx(), tx(-1250)]);
		const second = await dedupeHashes(ing("IBAN: nl91 ingb 0004 3862 74 (J. Jansen)", "ING Bank N.V."), [tx(), tx()]);
		expect(second).toEqual(first.slice(0, 2));
	});

	it("differs per account, currency, date and amount", async () => {
		const hashes = await Promise.all([
			dedupeHashes(ing("NL91INGB0004386274"), [tx()]),
			dedupeHashes(ing("NL02INGB0000000002"), [tx()]),
			dedupeHashes(ing("NL91INGB0004386274", "ING", "USD"), [tx()]),
			dedupeHashes(ing("NL91INGB0004386274"), [tx(-4.61)]),
			dedupeHashes(ing("NL91INGB0004386274"), [tx(-4.6, "2026-09-16")]),
		]);
		expect(new Set(hashes.map((h) => h[0])).size).toBe(5);
	});

	it("falls back to bank + account name without an IBAN", () => {
		expect(accountKey({ account: "Current Account", bank: "Revolut", currency: "EUR" })).toBe("REVOLUT:CURRENTACCOUNT|EUR");
		expect(accountKey({ account: "current account", bank: "revolut", currency: "eur" })).toBe("REVOLUT:CURRENTACCOUNT|EUR");
	});
});

describe("text helpers", () => {
	it("normalizes descriptions", () => {
		expect(normalizeDescription("Café  De-Klos, AMSTERDAM!")).toBe("cafe de klos amsterdam");
	});
	it("normalizes category labels", () => {
		expect(normalizeCategory(" bars and nightlife ")).toBe("Bars & Nightlife");
		expect(normalizeCategory("Groceries")).toBe("Groceries");
	});
	it("detects missing text layers, ignoring PDF metadata", () => {
		expect(hasUsableText("![page 1](data:image/png;base64,AAAA)\n")).toBe(false);
		const scanned = "# scan.pdf\n## Metadata\n- PDFFormatVersion=1.7\n- Producer=pdf-lib (https://github.com/Hopding/pdf-lib)\n" +
			"- ModDate=D:20261115202409Z\n- CreationDate=D:20261115202409Z\n".repeat(3) + "\n## Contents\n### Page 1\n\n\n";
		expect(hasUsableText(prepareStatementText(scanned))).toBe(false);
		expect(hasUsableText("01-09-2026 RENT 1.250,00\n".repeat(20))).toBe(true);
	});
	it("puts date headings glued to the previous line back on their own line", () => {
		const md = "## Metadata\n- x=1\n## Contents\n### Page 1\nEnding balance: € 2.500,242026-10-01\n" +
			"De Key -€ 1.250,00WONINGSTICHTING DE KEY HUUR2026-10-02\nSavings -€ 300,00NAAR SPAARREKENING NL12INGB00012345672026-10-27\n" +
			"Balance summary1 Sep 2026\nRENT 1.250,00 01-09-2026";
		expect(prepareStatementText(md)).toBe(
			"### Page 1\nEnding balance: € 2.500,24\n2026-10-01\nDe Key -€ 1.250,00WONINGSTICHTING DE KEY HUUR\n2026-10-02\n" +
				"Savings -€ 300,00NAAR SPAARREKENING NL12INGB0001234567\n2026-10-27\nBalance summary\n1 Sep 2026\nRENT 1.250,00 01-09-2026",
		);
	});
	it("chunks on line boundaries without losing text", () => {
		const text = Array.from({ length: 100 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n");
		const chunks = chunkText(text, 1000);
		expect(chunks.every((c) => c.length <= 1000)).toBe(true);
		expect(chunks.join("\n")).toBe(text);
	});
});

describe("fixSignsFromRunningBalance", () => {
	it("flips signs that contradict the running balance", () => {
		const txs = [
			{ amount: -1250, balance: 262.4 }, // ok
			{ amount: -22.5, balance: 284.9 }, // balance went up: money in
			{ amount: 3412.55, balance: 3697.45 }, // ok
		];
		expect(fixSignsFromRunningBalance(txs, 1512.4)).toBe(1);
		expect(txs.map((t) => t.amount)).toEqual([-1250, 22.5, 3412.55]);
	});
	it("leaves rows alone when the balance doesn't explain the amount or is missing", () => {
		const txs = [
			{ amount: -10, balance: null },
			{ amount: -5, balance: 100 }, // previous unknown
			{ amount: -7, balance: 110 }, // delta 10 != 7
		];
		expect(fixSignsFromRunningBalance(txs, 115)).toBe(0);
		expect(txs.map((t) => t.amount)).toEqual([-10, -5, -7]);
	});
});

describe("chunking and detection", () => {
	it("prefers to end a chunk before a line that starts with a date", () => {
		const row = (d: number) => `2026-10-${String(d).padStart(2, "0")} 2026-10-${String(d).padStart(2, "0")} SHOP ${d}\nNL00BANK0000000000\nGroceries - € 12,50`;
		const text = Array.from({ length: 20 }, (_, i) => row(i + 1)).join("\n");
		const chunks = chunkText(text, 400);
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) expect(c.startsWith("2026-10-")).toBe(true);
		expect(chunks.join("\n")).toBe(text);
	});
	it("unglues month-first dates in the middle of a line", () => {
		expect(prepareStatementText("Card: 123456******1234Sep 9, 2026 Coffee €3.50")).toBe("Card: 123456******1234\nSep 9, 2026 Coffee €3.50");
	});
	it("recognises text that contains transactions", () => {
		expect(looksLikeTransactions("Sep 9, 2026 Coffee €3.50 €10.00\nSep 10, 2026 Bread €2.10 €7.90")).toBe(true);
		expect(looksLikeTransactions("Terms and conditions apply.\nPage 2 of 9")).toBe(false);
	});
	it("estimates a lower bound of transaction rows", () => {
		const table = "Datum Omschrijving Bedrag\n01-09-2026 RENT Af 1.250,00\nBetaalautomaat\n02-09-2026 SHOP Af 12,70\nPeriode 01-09-2026 t/m 30-09-2026";
		expect(minimumTransactionRows(table)).toBe(2);
		const multiLine = "2026-10-01 2026-10-01 SHOP\nNL00BANK0000000000\nGroceries - € 12,50\n2026-10-02 2026-10-02 CAFE\nNL00BANK0000000001\nCoffee - € 3,50";
		expect(minimumTransactionRows(multiLine)).toBe(2);
		const grouped = "2026-10-04\nBasic-Fit -€ 29,99\nUNICEF -€ 13,04\n2026-10-05\nAH -€ 21,12";
		expect(minimumTransactionRows(grouped)).toBe(2); // one per date heading: a lower bound
	});
	it("widens the period to cover all transaction dates", () => {
		const merged = mergeChunks([
			parseChunkExtraction(chunk({
				period_start: "2026-08-01", period_end: "2026-09-07",
				transactions: [{ date: "2026-10-20", description: "A", merchant: null, amount: -1, currency: null, balance: null }],
			})),
		]);
		expect([merged.period_start, merged.period_end]).toEqual(["2026-08-01", "2026-10-20"]);
	});
});

describe("overlap safeguards", () => {
	const tx = (date: string, amount: number) => ({ date, amount });
	const stored = (id: string, date: string, amount: number, hash = `h-${id}`) => ({ id, date, amount, dedupe_hash: hash });

	it("measures how well two statements line up in their overlap", () => {
		const fresh = [tx("2026-10-01", -10), tx("2026-10-02", -20), tx("2026-10-02", -20), tx("2026-10-05", -30), tx("2026-11-01", -5)];
		const existing = [tx("2026-09-30", -1), tx("2026-10-01", -10), tx("2026-10-02", -20), tx("2026-10-05", -30)];
		expect(overlapMatch(fresh, existing, "2026-10-01", "2026-10-31")).toEqual({ rows: 4, matched: 3, ratio: 0.75 });
	});

	it("pairs a payment read with a slightly different date, one-to-one", () => {
		const fresh = [tx("2026-10-03", -12.5), tx("2026-10-10", -4.6), tx("2026-10-10", -4.6)];
		const hashes = ["new-a", "h-b", "new-c"];
		const existing = [stored("a", "2026-10-02", -12.5), stored("b", "2026-10-10", -4.6), stored("c", "2026-10-20", -4.6)];
		// a: same amount 1 day apart -> paired. Row 2 (4.60 on 10 Oct) matches b exactly via its hash;
		// row 3 has no exact match and the only other 4.60 is 10 days away -> new.
		expect([...pairNearDuplicates(fresh, hashes, existing)]).toEqual([[0, "a"]]);
	});

	it("never pairs two new rows with the same stored transaction", () => {
		const fresh = [tx("2026-10-03", -9.99), tx("2026-10-04", -9.99)];
		const existing = [stored("a", "2026-10-03", -9.99)];
		expect(pairNearDuplicates(fresh, ["x", "y"], existing).size).toBe(1);
	});
});
