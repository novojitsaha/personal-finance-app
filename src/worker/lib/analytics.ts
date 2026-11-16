// Pure analytics over stored transactions: dashboard aggregates, recurring
// payments, unusual-charge flags and budgets. No bindings, so it is unit tested
// directly (analytics.test.ts); the API routes load rows from D1 and call these.
//
// Money conventions: amounts are signed (negative = money out). Spending is the
// net outflow of spending categories (refunds in a category reduce it); Income
// is the Income category; Transfers are reported separately and never count as
// spending or income.
import { type Category, type GroupName, GROUPS, groupOf, isSpendingCategory } from "../../shared/categories";
import type {
	BudgetMonth,
	CategoryAmount,
	DashboardKpis,
	Flag,
	MerchantAmount,
	RecurringSuggestion,
	Subscription,
	TrendMonth,
} from "../../shared/api";

export interface Tx {
	id: string;
	statement_id: string;
	date: string;
	description: string;
	merchant: string | null;
	merchant_key: string;
	amount: number;
	currency: string;
	category: Category;
	category_source: "ai" | "user";
	/** Merchant name as extracted, before renames and merges. */
	raw_merchant: string | null;
	/** Description pattern, see variantKey() in merchants.ts. */
	variant_key: string;
}

export interface Rule {
	id: number;
	merchant_key: string;
	merchant: string;
	amount: number;
	tolerance: number;
	category: string | null;
	created_at: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Same as the `merchant_key` generated column in D1:
 * lower(trim(coalesce(nullif(merchant, ''), description))). SQLite's lower()
 * and trim() only touch ASCII letters and spaces, so this does the same.
 */
export function merchantKey(merchant: string | null, description: string): string {
	const s = merchant ? merchant : description;
	return s.replace(/^ +| +$/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(month: string, n: number): string {
	const [y, m] = month.split("-").map(Number);
	const d = new Date(Date.UTC(y, m - 1 + n, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addDays(date: string, n: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function median(values: number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function months(txs: Tx[]): string[] {
	return [...new Set(txs.map((t) => monthOf(t.date)))].sort();
}

/** Most common currency, used for display (amounts are not converted). */
export function mainCurrency(txs: Tx[]): string {
	const count = new Map<string, number>();
	for (const t of txs) count.set(t.currency, (count.get(t.currency) ?? 0) + 1);
	return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function kpis(txs: Tx[]): DashboardKpis {
	let spent = 0;
	let income = 0;
	let transfersIn = 0;
	let transfersOut = 0;
	for (const t of txs) {
		if (t.category === "Transfers") {
			if (t.amount > 0) transfersIn += t.amount;
			else transfersOut -= t.amount;
		} else if (t.category === "Income") income += t.amount;
		else spent -= t.amount;
	}
	return {
		spent: round2(spent),
		income: round2(income),
		net: round2(income - spent),
		transfers_in: round2(transfersIn),
		transfers_out: round2(transfersOut),
		count: txs.length,
	};
}

export function spendingByCategory(txs: Tx[]): CategoryAmount[] {
	const by = new Map<string, number>();
	for (const t of txs) if (isSpendingCategory(t.category)) by.set(t.category, (by.get(t.category) ?? 0) - t.amount);
	const total = [...by.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
	return [...by.entries()]
		.filter(([, v]) => v > 0.005)
		.map(([category, amount]) => ({
			category: category as Category,
			group: groupOf(category),
			amount: round2(amount),
			share: total ? amount / total : 0,
		}))
		.sort((a, b) => b.amount - a.amount);
}

export function topMerchants(txs: Tx[], limit = 8): MerchantAmount[] {
	const by = new Map<string, MerchantAmount>();
	for (const t of txs) {
		if (!isSpendingCategory(t.category) || t.amount >= 0) continue;
		const m = by.get(t.merchant_key) ?? { merchant: t.merchant ?? t.description, merchant_key: t.merchant_key, category: t.category, amount: 0, count: 0 };
		m.amount = round2(m.amount - t.amount);
		m.count++;
		by.set(t.merchant_key, m);
	}
	return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export function trend(txs: Tx[]): TrendMonth[] {
	const by = new Map<string, TrendMonth>();
	for (const m of months(txs)) {
		by.set(m, { month: m, income: 0, spent: 0, groups: Object.fromEntries(GROUPS.map((g) => [g.name, 0])) as Record<GroupName, number> });
	}
	for (const t of txs) {
		const row = by.get(monthOf(t.date))!;
		if (t.category === "Income") row.income = round2(row.income + t.amount);
		else if (isSpendingCategory(t.category)) {
			row.spent = round2(row.spent - t.amount);
			const g = groupOf(t.category);
			row.groups[g] = round2(row.groups[g] - t.amount);
		}
	}
	return [...by.values()];
}

// ---------------------------------------------------------------------------
// Recurring payments
// ---------------------------------------------------------------------------

/**
 * Match money-out transactions to the user's recurring rules. Per rule, the
 * merchant's charges are walked in date order; a charge matches when it is
 * within the tolerance of the rule amount or of the previous matched charge,
 * so gradual price changes are followed. Returns transaction id -> rule id.
 */
export function matchRecurring(txs: Tx[], rules: Rule[]): Map<string, number> {
	const out = new Map<string, number>();
	const byKey = groupBy(txs.filter((t) => t.amount < 0), (t) => t.merchant_key);
	for (const rule of rules) {
		const charges = (byKey.get(rule.merchant_key) ?? []).sort((a, b) => a.date.localeCompare(b.date));
		let previous: number | null = null;
		for (const t of charges) {
			const amount = -t.amount;
			const near = (ref: number) => Math.abs(amount - ref) <= ref * rule.tolerance + 0.005;
			if (near(rule.amount) || (previous !== null && near(previous))) {
				if (!out.has(t.id)) out.set(t.id, rule.id);
				previous = amount;
			}
		}
	}
	return out;
}

/**
 * Subscriptions view: per rule its current monthly cost (latest charge), last
 * charge, and warnings when the price went up or a charge is overdue.
 * "Overdue" is relative to the latest transaction date in the data (uploads
 * are completed statements, so "today" is the end of the data).
 */
export function subscriptions(txs: Tx[], rules: Rule[], matches: Map<string, number>): Subscription[] {
	const latest = txs.reduce((max, t) => (t.date > max ? t.date : max), "");
	const byRule = groupBy(
		txs.filter((t) => matches.has(t.id)),
		(t) => matches.get(t.id)!,
	);
	return rules
		.map((rule) => {
			const charges = (byRule.get(rule.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
			const last = charges.at(-1) ?? null;
			const warnings: Subscription["warnings"] = [];
			// Price went up within the last 3 charges.
			for (let i = charges.length - 1; i >= Math.max(1, charges.length - 2); i--) {
				const from = -charges[i - 1].amount;
				const to = -charges[i].amount;
				if (to > from * 1.01 && to - from >= 0.5) {
					warnings.push({
						code: "price_up",
						message: `Price went up from ${money(from, charges[i].currency)} to ${money(to, charges[i].currency)} on ${charges[i].date}.`,
					});
					break;
				}
			}
			const monthly = round2(last ? -last.amount : rule.amount);
			if (last) {
				const expected = addDays(last.date, 31);
				if (addDays(expected, 5) < latest) {
					warnings.push({ code: "missed", message: `No charge since ${last.date}; the next one was expected around ${expected}.` });
				}
			}
			return {
				id: rule.id,
				merchant: rule.merchant,
				merchant_key: rule.merchant_key,
				category: (last?.category ?? rule.category ?? "Other") as Category,
				monthly,
				yearly: round2(monthly * 12),
				tolerance: rule.tolerance,
				charges: charges.length,
				last_date: last?.date ?? null,
				last_amount: last ? round2(-last.amount) : null,
				currency: last?.currency ?? "EUR",
				warnings,
			};
		})
		.sort((a, b) => b.monthly - a.monthly);
}

/**
 * Likely recurring payments the user hasn't confirmed: money out (not
 * Transfers) to the same merchant in 3+ different months, where at least 70%
 * of the charges are within 10% of their median and there are at most ~1.5
 * charges per month (so a supermarket visited weekly isn't suggested).
 */
export function recurringSuggestions(txs: Tx[], rules: Rule[], dismissed: Set<string>): RecurringSuggestion[] {
	const ruled = new Set(rules.map((r) => r.merchant_key));
	const byKey = groupBy(
		txs.filter((t) => t.amount < 0 && t.category !== "Transfers"),
		(t) => t.merchant_key,
	);
	const out: RecurringSuggestion[] = [];
	for (const [key, charges] of byKey) {
		if (ruled.has(key) || dismissed.has(key)) continue;
		const amounts = charges.map((t) => -t.amount);
		const typical = median(amounts);
		const similar = charges.filter((t) => Math.abs(-t.amount - typical) <= typical * 0.1);
		const similarMonths = new Set(similar.map((t) => monthOf(t.date)));
		const allMonths = new Set(charges.map((t) => monthOf(t.date)));
		if (similarMonths.size < 3 || similar.length / charges.length < 0.7 || charges.length / allMonths.size > 1.5) continue;
		const last = charges.reduce((a, b) => (b.date > a.date ? b : a));
		out.push({
			merchant_key: key,
			merchant: last.merchant ?? last.description,
			category: last.category,
			amount: round2(typical),
			months: similarMonths.size,
			count: similar.length,
			last_date: last.date,
			currency: last.currency,
			transaction_id: last.id,
		});
	}
	return out.sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Unusual charges
// ---------------------------------------------------------------------------

export const FLAG_RULES = {
	/** A charge over this multiple of the merchant's median earlier charge... */
	largeMultiple: 2.5,
	/** ...needs at least this many earlier charges... */
	largeMinHistory: 3,
	/** ...and must be at least this much, to skip trivial amounts. */
	largeMinAmount: 20,
	/** First charge from a merchant at or above this amount... */
	firstTimeMinAmount: 250,
	/** ...counts only when there is this much earlier history in the data. */
	firstTimeMinHistoryDays: 30,
	/** Same merchant and amount within this many days is a likely duplicate... */
	duplicateDays: 2,
	/** ...for amounts of at least this much (two coffees are normal). */
	duplicateMinAmount: 10,
} as const;

/**
 * Unusual money-out transactions, each with the reason. Rules (see FLAG_RULES):
 * - large_vs_usual: more than 2.5x the merchant's median earlier charge, with
 *   at least 3 earlier charges and at least 20.
 * - first_time_large: first ever transaction with a merchant, 250 or more,
 *   when the data has at least 30 days of earlier history.
 * - possible_duplicate: same merchant and amount as another charge up to 2
 *   days earlier (amounts of 10 or more).
 * - price_up: a recurring charge more than 1% (and 0.50) above the previous one.
 * - bank_fee: anything categorized as Fees & Charges.
 * Transfers are skipped except for duplicates. Dismissed (transaction, code)
 * pairs are left out.
 */
export function flags(txs: Tx[], matches: Map<string, number>, dismissed: Set<string>): Map<string, Flag[]> {
	const out = new Map<string, Flag[]>();
	const add = (t: Tx, code: Flag["code"], reason: string) => {
		if (dismissed.has(`${t.id}:${code}`)) return;
		const list = out.get(t.id) ?? [];
		list.push({ code, reason });
		out.set(t.id, list);
	};
	const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
	const earliest = sorted[0]?.date ?? "";
	const history = new Map<string, Tx[]>(); // merchant_key -> earlier transactions (any direction)
	const lastRecurring = new Map<number, Tx>();

	for (const t of sorted) {
		const earlier = history.get(t.merchant_key) ?? [];
		const amount = -t.amount;
		if (t.amount < 0) {
			const name = t.merchant ?? t.description;
			const isTransfer = t.category === "Transfers";
			const earlierCharges = earlier.filter((e) => e.amount < 0).map((e) => -e.amount);
			if (!isTransfer && earlierCharges.length >= FLAG_RULES.largeMinHistory && amount >= FLAG_RULES.largeMinAmount) {
				const usual = median(earlierCharges);
				if (amount > usual * FLAG_RULES.largeMultiple) {
					add(t, "large_vs_usual", `${money(amount, t.currency)} is ${(amount / usual).toFixed(1)}× the usual ${money(usual, t.currency)} at ${name}.`);
				}
			}
			if (
				!isTransfer &&
				earlier.length === 0 &&
				amount >= FLAG_RULES.firstTimeMinAmount &&
				daysBetween(earliest, t.date) >= FLAG_RULES.firstTimeMinHistoryDays
			) {
				add(t, "first_time_large", `First payment to ${name}, and a large one (${money(amount, t.currency)}).`);
			}
			if (amount >= FLAG_RULES.duplicateMinAmount) {
				const twin = earlier.find((e) => e.amount === t.amount && daysBetween(e.date, t.date) <= FLAG_RULES.duplicateDays);
				if (twin) add(t, "possible_duplicate", `Same amount as another ${name} charge on ${twin.date}; possibly charged twice.`);
			}
			const rule = matches.get(t.id);
			if (rule !== undefined) {
				const prev = lastRecurring.get(rule);
				if (prev && amount > -prev.amount * 1.01 && amount - -prev.amount >= 0.5) {
					add(t, "price_up", `Recurring charge went up from ${money(-prev.amount, prev.currency)} to ${money(amount, t.currency)}.`);
				}
				lastRecurring.set(rule, t);
			}
			if (t.category === "Fees & Charges") add(t, "bank_fee", "Bank fee or charge.");
		}
		earlier.push(t);
		history.set(t.merchant_key, earlier);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** Category -> monthly budget; "*" is the overall budget. */
export type Budgets = Record<string, number>;

/** Spent vs budget per month (newest first), for months that have data. */
export function budgetReport(txs: Tx[], budgets: Budgets): BudgetMonth[] {
	const byMonth = groupBy(txs, (t) => monthOf(t.date));
	return [...byMonth.keys()]
		.sort()
		.reverse()
		.map((month) => {
			const list = byMonth.get(month)!;
			const spentBy = new Map(spendingByCategory(list).map((c) => [c.category as string, c.amount]));
			const status = (spent: number, budget: number | null) =>
				budget === null ? null : { budget, diff: round2(budget - spent), over: spent > budget + 0.005 };
			const total = kpis(list).spent;
			const categories = Object.keys(budgets)
				.filter((c) => c !== "*")
				.map((category) => {
					const spent = spentBy.get(category) ?? 0;
					return { category: category as Category, spent, ...status(spent, budgets[category])! };
				})
				.sort((a, b) => Number(b.over) - Number(a.over) || a.diff - b.diff);
			return { month, total: { spent: total, ...(status(total, budgets["*"] ?? null) ?? { budget: null, diff: null, over: null }) }, categories };
		});
}

// ---------------------------------------------------------------------------

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
	const out = new Map<K, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = out.get(k);
		if (list) list.push(item);
		else out.set(k, [item]);
	}
	return out;
}

export function money(amount: number, currency: string): string {
	try {
		return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${currency}`;
	}
}
