// Read-only finance tools for the AI: used by the in-app chat and the MCP
// server (/mcp). Each tool runs the same fixed queries and pure functions as
// the dashboard (no SQL from the model) and returns a compact JSON summary,
// so answers match what the app shows and stay cheap in tokens.
import { z } from "zod";
import { CATEGORIES, type Category } from "../../shared/categories";
import { addMonths, budgetReport, kpis, monthOf, months as monthsOf, spendingByCategory, subscriptions, topMerchants, type Tx } from "./analytics";
import { type Data, load } from "./data";

const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const month = z.string().regex(MONTH).describe("A month as YYYY-MM");
const day = z.string().regex(DAY);
const category = z.enum(CATEGORIES as unknown as [Category, ...Category[]]);

/** A period: one month, or a from/to date range; empty means all data. */
const period = {
	month: month.optional().describe("Only this month (YYYY-MM)"),
	from: day.optional().describe("Start date, inclusive (YYYY-MM-DD)"),
	to: day.optional().describe("End date, inclusive (YYYY-MM-DD)"),
};
type Period = { month?: string; from?: string; to?: string };

const inPeriod = (t: Tx, p: Period) =>
	(!p.month || monthOf(t.date) === p.month) && (!p.from || t.date >= p.from) && (!p.to || t.date <= p.to);

const describePeriod = (p: Period, data: Data) => {
	if (p.month) return p.month;
	const ms = monthsOf(data.all);
	return `${p.from ?? ms[0] ?? "start"} to ${p.to ?? ms.at(-1) ?? "end"}`;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Merchants whose name matches the query: exact first, then containing it. */
function findMerchants(data: Data, query: string): { key: string; name: string; count: number }[] {
	const q = norm(query);
	const by = new Map<string, { key: string; name: string; count: number }>();
	for (const t of data.all) {
		const name = t.merchant ?? t.description;
		const m = by.get(t.merchant_key) ?? { key: t.merchant_key, name, count: 0 };
		m.count++;
		by.set(t.merchant_key, m);
	}
	const all = [...by.values()];
	const exact = all.filter((m) => norm(m.name) === q || norm(m.key) === q);
	if (exact.length) return exact;
	return all.filter((m) => norm(m.name).includes(q) || norm(m.key).includes(q)).sort((a, b) => b.count - a.count);
}

const txOut = (t: Tx) => ({ date: t.date, merchant: t.merchant ?? t.description, amount: t.amount, category: t.category, description: t.description.slice(0, 80) });

export interface FinanceTool<S extends z.ZodObject = z.ZodObject> {
	name: string;
	description: string;
	inputSchema: S;
	execute(data: Data, input: z.infer<S>): unknown;
}

const tool = <S extends z.ZodObject>(t: FinanceTool<S>) => t;

export const TOOLS = [
	tool({
		name: "get_overview",
		description:
			"Totals for a month or period: money spent, income, net, transfers, number of transactions, the change versus the previous month, top spending categories and merchants, and how many charges look unusual. Also lists which months have data. Start here.",
		inputSchema: z.object(period),
		execute(data, p) {
			const list = data.all.filter((t) => inPeriod(t, p));
			const prev = p.month ? data.all.filter((t) => monthOf(t.date) === addMonths(p.month!, -1)) : [];
			return {
				period: describePeriod(p, data),
				currency: data.currency,
				months_with_data: monthsOf(data.all),
				totals: kpis(list),
				previous_month: p.month && prev.length ? { month: addMonths(p.month, -1), totals: kpis(prev) } : null,
				top_categories: spendingByCategory(list).slice(0, 8).map((c) => ({ category: c.category, amount: c.amount, share: r2(c.share) })),
				top_merchants: topMerchants(list, 8).map((m) => ({ merchant: m.merchant, category: m.category, amount: m.amount, count: m.count })),
				unusual_charges: list.filter((t) => data.flagMap.has(t.id)).length,
			};
		},
	}),
	tool({
		name: "search_transactions",
		description:
			"Find transactions by merchant name, category, period, amount or text. Returns the number of matches, the totals, and up to `limit` transactions (newest or largest first). Amounts are negative for money out and positive for money in.",
		inputSchema: z.object({
			...period,
			merchant: z.string().optional().describe("Merchant name or part of it, e.g. 'Albert Heijn'"),
			category: category.optional(),
			direction: z.enum(["out", "in"]).optional().describe("Only money out (spending) or money in"),
			min_amount: z.number().optional().describe("Minimum absolute amount"),
			max_amount: z.number().optional().describe("Maximum absolute amount"),
			text: z.string().optional().describe("Text to look for in the description"),
			sort: z.enum(["newest", "largest"]).optional().describe("Order of the listed transactions: newest first (default) or largest amount first"),
			limit: z.number().int().min(1).max(50).optional().describe("Max transactions to list (default 20)"),
		}),
		execute(data, q) {
			const merchants = q.merchant ? findMerchants(data, q.merchant) : null;
			const keys = merchants ? new Set(merchants.map((m) => m.key)) : null;
			const text = q.text ? norm(q.text) : null;
			const list = data.all.filter(
				(t) =>
					inPeriod(t, q) &&
					(!keys || keys.has(t.merchant_key)) &&
					(!q.category || t.category === q.category) &&
					(!q.direction || (q.direction === "out" ? t.amount < 0 : t.amount > 0)) &&
					(q.min_amount == null || Math.abs(t.amount) >= q.min_amount) &&
					(q.max_amount == null || Math.abs(t.amount) <= q.max_amount) &&
					(!text || norm(`${t.merchant ?? ""} ${t.description}`).includes(text)),
			);
			const out = list.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0);
			const inn = list.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
			return {
				period: describePeriod(q, data),
				currency: data.currency,
				matched_merchants: merchants?.slice(0, 10).map((m) => m.name),
				count: list.length,
				total_out: r2(out),
				total_in: r2(inn),
				transactions: (q.sort === "largest" ? [...list].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)) : [...list].reverse()).slice(0, q.limit ?? 20).map(txOut),
			};
		},
	}),
	tool({
		name: "spending_by_category",
		description: "Spending per category for a month or period (excluding transfers and income), with each category's share of total spending and number of transactions.",
		inputSchema: z.object(period),
		execute(data, p) {
			const list = data.all.filter((t) => inPeriod(t, p));
			const counts = new Map<string, number>();
			for (const t of list) if (t.amount < 0) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
			return {
				period: describePeriod(p, data),
				currency: data.currency,
				total_spent: kpis(list).spent,
				categories: spendingByCategory(list).map((c) => ({ category: c.category, group: c.group, amount: c.amount, share: r2(c.share), count: counts.get(c.category) ?? 0 })),
			};
		},
	}),
	tool({
		name: "compare_periods",
		description:
			"Compare spending between two months, per category or per merchant, sorted by the biggest change. Optionally only one category (e.g. compare Restaurants between September and October).",
		inputSchema: z.object({
			a: month.describe("First (earlier) month, YYYY-MM"),
			b: month.describe("Second (later) month, YYYY-MM"),
			by: z.enum(["category", "merchant"]).optional().describe("Group by category (default) or merchant"),
			category: category.optional().describe("Only this category"),
			limit: z.number().int().min(1).max(40).optional(),
		}),
		execute(data, q) {
			const spendOf = (m: string) => {
				const map = new Map<string, number>();
				for (const t of data.all) {
					if (monthOf(t.date) !== m || t.amount >= 0 || (q.category && t.category !== q.category)) continue;
					if (t.category === "Transfers" || t.category === "Income") continue;
					const k = q.by === "merchant" ? (t.merchant ?? t.description) : t.category;
					map.set(k, (map.get(k) ?? 0) - t.amount);
				}
				return map;
			};
			const a = spendOf(q.a);
			const b = spendOf(q.b);
			const rows = [...new Set([...a.keys(), ...b.keys()])]
				.map((k) => ({ name: k, [q.a]: r2(a.get(k) ?? 0), [q.b]: r2(b.get(k) ?? 0), change: r2((b.get(k) ?? 0) - (a.get(k) ?? 0)) }))
				.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
			const sum = (m: Map<string, number>) => r2([...m.values()].reduce((s, v) => s + v, 0));
			return {
				currency: data.currency,
				by: q.by ?? "category",
				category: q.category ?? null,
				total: { [q.a]: sum(a), [q.b]: sum(b), change: r2(sum(b) - sum(a)) },
				rows: rows.slice(0, q.limit ?? 15),
			};
		},
	}),
	tool({
		name: "merchant_detail",
		description:
			"Everything about one merchant: total spent and received, number of payments, average payment, spending per month, its category, whether it is a recurring payment, and its latest transactions. Matches the merchant by name.",
		inputSchema: z.object({ merchant: z.string().describe("Merchant name, e.g. 'Albert Heijn'") }),
		execute(data, q) {
			const found = findMerchants(data, q.merchant);
			if (!found.length) return { error: `No merchant matches "${q.merchant}".` };
			const m = found[0];
			const list = data.all.filter((t) => t.merchant_key === m.key);
			const spentList = list.filter((t) => t.amount < 0);
			const spent = r2(-spentList.reduce((a, t) => a + t.amount, 0));
			const byMonth = new Map<string, number>();
			for (const t of spentList) byMonth.set(monthOf(t.date), r2((byMonth.get(monthOf(t.date)) ?? 0) - t.amount));
			const rule = data.rules.find((r) => r.merchant_key === m.key);
			return {
				merchant: m.name,
				other_matches: found.slice(1, 6).map((f) => f.name),
				currency: data.currency,
				category: list.at(-1)!.category,
				count: list.length,
				spent,
				received: r2(list.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0)),
				average_payment: spentList.length ? r2(spent / spentList.length) : 0,
				first_date: list[0].date,
				last_date: list.at(-1)!.date,
				spent_by_month: Object.fromEntries(byMonth),
				recurring: rule ? { monthly_amount: rule.amount } : null,
				latest: [...list].reverse().slice(0, 10).map(txOut),
			};
		},
	}),
	tool({
		name: "subscriptions",
		description:
			"Recurring payments marked as subscriptions: monthly and yearly cost, last charge, and warnings such as a price increase or a missed charge. Also the total per month and per year.",
		inputSchema: z.object({}),
		execute(data) {
			const subs = subscriptions(data.all, data.rules, data.matches);
			const monthly = r2(subs.reduce((a, s) => a + s.monthly, 0));
			return {
				currency: data.currency,
				monthly_total: monthly,
				yearly_total: r2(monthly * 12),
				subscriptions: subs.map((s) => ({
					merchant: s.merchant,
					category: s.category,
					monthly: s.monthly,
					last_date: s.last_date,
					last_amount: s.last_amount,
					charges: s.charges,
					warnings: s.warnings.map((w) => w.message),
				})),
			};
		},
	}),
	tool({
		name: "budget_status",
		description: "Monthly budgets versus actual spending per category for a month (default: the latest month with data), including which budgets are over.",
		inputSchema: z.object({ month: month.optional() }),
		async execute(data, q) {
			const budgets = data.budgets;
			if (!Object.keys(budgets).length) return { message: "No budgets are set. Budgets can be added on the Budgets page." };
			const report = budgetReport(data.all, budgets);
			const target = q.month ?? monthsOf(data.all).at(-1);
			const m = report.find((r) => r.month === target);
			return { currency: data.currency, month: target, budgets, report: m ?? null };
		},
	}),
	tool({
		name: "unusual_charges",
		description:
			"Charges flagged as unusual: much larger than usual for the merchant, a large first payment to a new merchant, possible duplicates, price increases of subscriptions, and bank fees. Optionally for one month or period.",
		inputSchema: z.object(period),
		execute(data, p) {
			const list = data.all.filter((t) => inPeriod(t, p) && data.flagMap.has(t.id));
			return {
				period: describePeriod(p, data),
				currency: data.currency,
				count: list.length,
				charges: [...list]
					.reverse()
					.slice(0, 30)
					.map((t) => ({ ...txOut(t), reasons: data.flagMap.get(t.id)!.map((f) => f.reason) })),
			};
		},
	}),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

/** Run a tool by name with already-validated input. */
export async function runTool(db: D1Database, name: string, input: unknown): Promise<unknown> {
	const t = TOOLS.find((x) => x.name === name) as FinanceTool | undefined;
	if (!t) throw new Error(`Unknown tool: ${name}`);
	const parsed = t.inputSchema.parse(input ?? {});
	const data = await load(db);
	return t.execute(data, parsed);
}
