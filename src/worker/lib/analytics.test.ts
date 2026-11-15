import { describe, expect, it } from "vitest";
import type { Category } from "../../shared/categories";
import {
	type Rule,
	type Tx,
	addMonths,
	budgetReport,
	flags,
	kpis,
	matchRecurring,
	merchantKey,
	recurringSuggestions,
	spendingByCategory,
	subscriptions,
	topMerchants,
	trend,
} from "./analytics";
import { type RawTx, resolveMerchants, variantKey } from "./merchants";

let seq = 0;
function tx(date: string, amount: number, merchant: string, category: Category = "Groceries", description = merchant.toUpperCase()): Tx {
	return {
		id: `t${++seq}`,
		statement_id: "s1",
		date,
		description,
		merchant,
		merchant_key: merchantKey(merchant, description),
		amount,
		currency: "EUR",
		category,
		category_source: "ai",
		raw_merchant: merchant,
		variant_key: variantKey(description),
	};
}
const rule = (merchant: string, amount: number, id = 1, tolerance = 0.1): Rule => ({
	id,
	merchant_key: merchantKey(merchant, merchant),
	merchant,
	amount,
	tolerance,
	category: null,
	created_at: "2026-01-01",
});

describe("totals", () => {
	const data = [
		tx("2026-09-01", -1250, "De Key", "Rent & Housing"),
		tx("2026-09-02", -40, "Albert Heijn"),
		tx("2026-09-03", 10, "Albert Heijn"), // refund reduces groceries
		tx("2026-09-24", 3000, "Acme", "Income"),
		tx("2026-09-25", -300, "Savings", "Transfers"),
		tx("2026-09-26", 50, "Friend", "Transfers"),
	];

	it("excludes transfers from spending and income, and nets refunds", () => {
		expect(kpis(data)).toEqual({ spent: 1280, income: 3000, net: 1720, transfers_in: 50, transfers_out: 300, count: 6 });
	});

	it("breaks spending down by category with shares", () => {
		const by = spendingByCategory(data);
		expect(by.map((c) => [c.category, c.amount])).toEqual([
			["Rent & Housing", 1250],
			["Groceries", 30],
		]);
		expect(by[0].share + by[1].share).toBeCloseTo(1);
		expect(by[0].group).toBe("Home & bills");
	});

	it("ranks top merchants by money out, without transfers", () => {
		expect(topMerchants(data).map((m) => m.merchant)).toEqual(["De Key", "Albert Heijn"]);
	});

	it("builds a monthly trend by group", () => {
		const t = trend([...data, tx("2026-10-02", -20, "Albert Heijn")]);
		expect(t.map((m) => [m.month, m.spent, m.income])).toEqual([
			["2026-09", 1280, 3000],
			["2026-10", 20, 0],
		]);
		expect(t[0].groups["Food & drink"]).toBe(30);
	});

	it("steps months across years", () => {
		expect(addMonths("2026-01", -1)).toBe("2025-12");
		expect(addMonths("2026-12", 1)).toBe("2027-01");
	});
});

describe("recurring", () => {
	const netflix = [
		tx("2026-06-07", -13.99, "Netflix", "Subscriptions"),
		tx("2026-07-07", -13.99, "Netflix", "Subscriptions"),
		tx("2026-08-07", -13.99, "Netflix", "Subscriptions"),
		tx("2026-09-07", -15.49, "Netflix", "Subscriptions"), // +10.7%
		tx("2026-10-07", -15.49, "Netflix", "Subscriptions"),
	];

	it("matches charges within the tolerance and follows a price change only within tolerance", () => {
		const m = matchRecurring(netflix, [rule("Netflix", 13.99, 1, 0.12)]);
		expect(m.size).toBe(5);
		const strict = matchRecurring(netflix, [rule("Netflix", 13.99, 1, 0.05)]);
		expect(strict.size).toBe(3);
	});

	it("reports monthly cost, price increases and missed charges", () => {
		const rules = [rule("Netflix", 13.99, 1, 0.12), rule("Basic-Fit", 29.99, 2)];
		const data = [
			...netflix,
			tx("2026-07-01", -29.99, "Basic-Fit", "Health & Fitness"),
			tx("2026-08-01", -29.99, "Basic-Fit", "Health & Fitness"),
			tx("2026-11-14", -5, "Albert Heijn"), // latest date in the data
		];
		const subs = subscriptions(data, rules, matchRecurring(data, rules));
		const nf = subs.find((s) => s.merchant === "Netflix")!;
		expect(nf).toMatchObject({ monthly: 15.49, yearly: 185.88, charges: 5, last_date: "2026-10-07" });
		// 13.99 -> 15.49 between the 3rd and 4th charge (within the last 3), and
		// no charge since 7 Oct while the data runs to 14 Nov.
		expect(nf.warnings.map((w) => w.code)).toEqual(["price_up", "missed"]);
		const gym = subs.find((s) => s.merchant === "Basic-Fit")!;
		expect(gym.warnings.map((w) => w.code)).toEqual(["missed"]);
	});

	it("suggests merchants charged a similar amount in 3+ months, but not weekly shopping or confirmed ones", () => {
		const data = [
			...netflix.slice(0, 3),
			tx("2026-06-01", -9.99, "Spotify", "Subscriptions"),
			tx("2026-07-01", -9.99, "Spotify", "Subscriptions"),
			tx("2026-08-01", -9.99, "Spotify", "Subscriptions"),
			...["06", "07", "08"].flatMap((m) => ["05", "12", "19", "26"].map((d) => tx(`2026-${m}-${d}`, -25, "Albert Heijn"))),
			tx("2026-06-03", -30, "Uber", "Transport"),
			tx("2026-07-09", -12, "Uber", "Transport"),
			tx("2026-08-21", -48, "Uber", "Transport"),
		];
		const s = recurringSuggestions(data, [rule("Spotify", 9.99)], new Set());
		expect(s.map((x) => [x.merchant, x.amount, x.months])).toEqual([["Netflix", 13.99, 3]]);
		expect(recurringSuggestions(data, [], new Set([merchantKey("Netflix", "")])).map((x) => x.merchant)).toEqual(["Spotify"]);
	});
});

describe("flags", () => {
	const history = [
		tx("2026-06-02", -40, "Albert Heijn"),
		tx("2026-06-09", -35, "Albert Heijn"),
		tx("2026-06-16", -45, "Albert Heijn"),
	];
	const codes = (data: Tx[], rules: Rule[] = [], dismissed = new Set<string>()) => {
		const f = flags(data, matchRecurring(data, rules), dismissed);
		return data.flatMap((t) => (f.get(t.id) ?? []).map((x) => `${t.merchant}:${x.code}`));
	};

	it("flags a charge far above the merchant's usual amount", () => {
		expect(codes([...history, tx("2026-06-20", -310, "Albert Heijn")])).toEqual(["Albert Heijn:large_vs_usual"]);
		expect(codes([...history, tx("2026-06-20", -95, "Albert Heijn")])).toEqual([]); // 2.4x: under 2.5x
		expect(codes([history[0], history[1], tx("2026-06-20", -310, "Albert Heijn")])).toEqual([]); // only 2 earlier charges
	});

	it("flags a large first-time charge only after 30 days of history", () => {
		expect(codes([tx("2026-06-01", -5, "Bakery"), tx("2026-07-15", -899, "MediaMarkt", "Shopping")])).toEqual(["MediaMarkt:first_time_large"]);
		expect(codes([tx("2026-06-01", -5, "Bakery"), tx("2026-06-10", -899, "MediaMarkt", "Shopping")])).toEqual([]);
		expect(codes([tx("2026-06-01", -5, "Bakery"), tx("2026-07-15", -899, "Savings", "Transfers")])).toEqual([]);
	});

	it("flags likely duplicates within 2 days, but not small amounts", () => {
		expect(codes([tx("2026-06-01", -59.9, "Zalando", "Clothing & Fashion"), tx("2026-06-02", -59.9, "Zalando", "Clothing & Fashion")])).toEqual([
			"Zalando:possible_duplicate",
		]);
		expect(codes([tx("2026-06-01", -59.9, "Zalando"), tx("2026-06-05", -59.9, "Zalando")])).toEqual([]);
		expect(codes([tx("2026-06-01", -4.6, "Starbucks"), tx("2026-06-01", -4.6, "Starbucks")])).toEqual([]);
	});

	it("flags recurring price increases and bank fees, and respects dismissals", () => {
		const data = [
			tx("2026-06-07", -13.99, "Netflix", "Subscriptions"),
			tx("2026-07-07", -14.99, "Netflix", "Subscriptions"),
			tx("2026-07-31", -3.65, "ING", "Fees & Charges"),
		];
		expect(codes(data, [rule("Netflix", 13.99)])).toEqual(["Netflix:price_up", "ING:bank_fee"]);
		expect(codes(data, [rule("Netflix", 13.99)], new Set([`${data[2].id}:bank_fee`]))).toEqual(["Netflix:price_up"]);
	});
});

describe("budgets", () => {
	it("reports spent vs budget per month, newest first", () => {
		const data = [
			tx("2026-09-02", -420, "Albert Heijn"),
			tx("2026-09-05", -80, "Restaurant", "Restaurants"),
			tx("2026-10-02", -300, "Albert Heijn"),
		];
		const report = budgetReport(data, { Groceries: 350, Restaurants: 100, "*": 450 });
		expect(report.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
		const sep = report[1];
		expect(sep.total).toEqual({ spent: 500, budget: 450, diff: -50, over: true });
		expect(sep.categories).toEqual([
			{ category: "Groceries", spent: 420, budget: 350, diff: -70, over: true },
			{ category: "Restaurants", spent: 80, budget: 100, diff: 20, over: false },
		]);
		expect(report[0].categories.find((c) => c.category === "Restaurants")).toMatchObject({ spent: 0, over: false });
	});
});

describe("merchant grouping", () => {
	const raw = (merchant: string | null, description: string, amount = -10): RawTx => {
		const t = tx("2026-09-01", amount, merchant ?? description, "Groceries", description);
		const rest: Partial<Tx> = { ...t };
		delete rest.raw_merchant;
		delete rest.variant_key;
		return { ...(rest as RawTx), merchant, merchant_key: merchantKey(merchant, description) };
	};
	const rows = [
		raw("Albert Heijn", "ALBERT HEIJN 1234 AMSTERDAM"),
		raw("AH", "AH 5678 UTRECHT"),
		raw("AH to go", "AH TO GO 5812 CENTRAAL"),
		raw("Jumbo", "JUMBO 77 AMSTERDAM"),
	];

	it("computes the same merchant key as the D1 generated column", () => {
		expect(merchantKey("  Albert Heijn ", "x")).toBe("albert heijn");
		expect(merchantKey(null, "AH TO GO 5812")).toBe("ah to go 5812");
		expect(merchantKey("Café De Klos", "x")).toBe("café de klos"); // SQLite lower() leaves non-ASCII alone
	});

	it("groups merged merchants under the canonical name", () => {
		const resolved = resolveMerchants(
			rows,
			[
				{ alias_key: "ah", canonical_key: "albert heijn", canonical_name: "Albert Heijn" },
				{ alias_key: "ah to go", canonical_key: "albert heijn", canonical_name: "Albert Heijn" },
			],
			[],
		);
		expect(resolved.map((t) => [t.merchant, t.merchant_key, t.raw_merchant])).toEqual([
			["Albert Heijn", "albert heijn", "Albert Heijn"],
			["Albert Heijn", "albert heijn", "AH"],
			["Albert Heijn", "albert heijn", "AH to go"],
			["Jumbo", "jumbo", "Jumbo"],
		]);
	});

	it("splits a description variant off into its own merchant, even if its name is merged elsewhere", () => {
		expect(variantKey("AH TO GO 5812 CENTRAAL")).toBe("ah to go centraal");
		const resolved = resolveMerchants(
			[...rows, raw("Albert Heijn", "AH TO GO 9999 CENTRAAL"), raw("AH to go", "AH TO GO 1111 SCHIPHOL")],
			[{ alias_key: "ah to go", canonical_key: "albert heijn", canonical_name: "Albert Heijn" }],
			[{ variant_key: "ah to go centraal", merchant_name: "AH to go" }],
		);
		// Both "AH TO GO ... CENTRAAL" rows are split off; the Schiphol one stays merged.
		expect(resolved.map((t) => [t.merchant, t.merchant_key])).toEqual([
			["Albert Heijn", "albert heijn"],
			["AH", "ah"],
			["AH to go", "variant:ah to go"],
			["Jumbo", "jumbo"],
			["AH to go", "variant:ah to go"],
			["Albert Heijn", "albert heijn"],
		]);
	});
});
