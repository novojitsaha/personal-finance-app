// Dashboard, transactions, merchants, recurring payments, budgets and flags.
// Every request loads the (personal-scale) transaction table once and runs the
// pure functions in lib/analytics.ts and lib/merchants.ts over it, so all views
// agree on merchant grouping, recurring matches and flags.
import { Hono } from "hono";
import { CATEGORIES, type Category } from "../../shared/categories";
import type {
	BudgetOverview,
	Dashboard,
	MerchantDetail,
	MerchantSummary,
	MerchantVariant,
	RecurringOverview,
	TransactionList,
	TransactionRow,
} from "../../shared/api";
import {
	type Budgets,
	type Rule,
	type Tx,
	budgetReport,
	flags as computeFlags,
	kpis,
	mainCurrency,
	matchRecurring,
	merchantKey,
	monthOf,
	months as monthsOf,
	recurringSuggestions,
	spendingByCategory,
	subscriptions,
	topMerchants,
	trend,
	addMonths,
} from "../lib/analytics";
import { type Alias, type RawTx, type VariantRule, resolveMerchants, splitKey } from "../lib/merchants";

type Env = { Bindings: Cloudflare.Env };
export const insights = new Hono<Env>();

const isCategory = (c: unknown): c is Category => typeof c === "string" && (CATEGORIES as readonly string[]).includes(c);
const MONTH = /^\d{4}-\d{2}$/;

async function load(db: D1Database) {
	const [txs, rules, aliases, variants, dismissals, dismissedSuggestions, overrides] = await db.batch([
		db.prepare(
			`SELECT id, statement_id, date, description, merchant, merchant_key, amount, currency, category, category_source
			 FROM transactions ORDER BY date, created_at, rowid`,
		),
		db.prepare("SELECT id, merchant_key, merchant, amount, tolerance, category, created_at FROM recurring_rules ORDER BY id"),
		db.prepare("SELECT alias_key, canonical_key, canonical_name FROM merchant_aliases"),
		db.prepare("SELECT variant_key, merchant_name FROM merchant_variant_rules"),
		db.prepare("SELECT transaction_id, code FROM flag_dismissals"),
		db.prepare("SELECT merchant_key FROM dismissed_recurring_suggestions"),
		db.prepare("SELECT merchant_key, category FROM merchant_overrides"),
	]);
	const raw = txs.results as unknown as RawTx[];
	const all = resolveMerchants(raw, aliases.results as unknown as Alias[], variants.results as unknown as VariantRule[]);
	const ruleList = rules.results as unknown as Rule[];
	const matches = matchRecurring(all, ruleList);
	const dismissed = new Set((dismissals.results as { transaction_id: string; code: string }[]).map((d) => `${d.transaction_id}:${d.code}`));
	const flagMap = computeFlags(all, matches, dismissed);
	const row = (t: Tx): TransactionRow => ({
		id: t.id,
		statement_id: t.statement_id,
		date: t.date,
		description: t.description,
		merchant: t.merchant ?? t.description,
		merchant_key: t.merchant_key,
		raw_merchant: t.raw_merchant,
		amount: t.amount,
		currency: t.currency,
		category: t.category,
		category_source: t.category_source,
		recurring_rule_id: matches.get(t.id) ?? null,
		flags: flagMap.get(t.id) ?? [],
	});
	return {
		raw,
		all,
		rules: ruleList,
		matches,
		flagMap,
		row,
		aliases: aliases.results as unknown as Alias[],
		variants: variants.results as unknown as VariantRule[],
		dismissedSuggestions: new Set((dismissedSuggestions.results as { merchant_key: string }[]).map((d) => d.merchant_key)),
		overrides: new Map((overrides.results as { merchant_key: string; category: Category }[]).map((o) => [o.merchant_key, o.category])),
		currency: mainCurrency(all),
	};
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

insights.get("/dashboard", async (c) => {
	const data = await load(c.env.DB);
	const months = monthsOf(data.all);
	const requested = c.req.query("period");
	const period = requested === "all" || (requested && MONTH.test(requested)) ? requested : (months.at(-1) ?? "all");
	const inPeriod = period === "all" ? data.all : data.all.filter((t) => monthOf(t.date) === period);
	const prevMonth = period === "all" ? null : addMonths(period, -1);
	const prev = prevMonth ? data.all.filter((t) => monthOf(t.date) === prevMonth) : [];
	const flagged = inPeriod.filter((t) => data.flagMap.has(t.id)).map(data.row);
	const body: Dashboard = {
		period,
		months,
		currency: data.currency,
		kpis: kpis(inPeriod),
		previous: prevMonth && prev.length ? kpis(prev) : null,
		by_category: spendingByCategory(inPeriod),
		previous_by_category: spendingByCategory(prev),
		top_merchants: topMerchants(inPeriod),
		trend: trend(data.all),
		flagged: { count: flagged.length, items: flagged.sort((a, b) => a.amount - b.amount).slice(0, 5) },
	};
	return c.json(body);
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * GET /api/transactions?month=YYYY-MM&category=..&merchant=key1,key2&q=..
 *   &recurring=1&flagged=1&sort=date|amount|merchant|category&dir=asc|desc&limit=&offset=
 */
insights.get("/transactions", async (c) => {
	const data = await load(c.env.DB);
	const q = c.req.query();
	const merchants = new Set((q.merchant ?? "").split(",").filter(Boolean));
	const categories = new Set((q.category ?? "").split(",").filter(Boolean));
	const search = (q.q ?? "").trim().toLowerCase();
	let list = data.all.filter(
		(t) =>
			(!q.month || monthOf(t.date) === q.month) &&
			(!categories.size || categories.has(t.category)) &&
			(!merchants.size || merchants.has(t.merchant_key)) &&
			(q.recurring !== "1" || data.matches.has(t.id)) &&
			(q.flagged !== "1" || data.flagMap.has(t.id)) &&
			(!search || `${t.merchant ?? ""} ${t.description} ${t.category}`.toLowerCase().includes(search)),
	);
	const dir = q.dir === "asc" ? 1 : -1;
	const sort = q.sort ?? "date";
	const value = (t: Tx): string | number =>
		sort === "amount" ? t.amount : sort === "merchant" ? (t.merchant ?? "").toLowerCase() : sort === "category" ? t.category : t.date;
	list = [...list].sort((a, b) => {
		const va = value(a);
		const vb = value(b);
		return (va < vb ? -1 : va > vb ? 1 : 0) * dir || b.date.localeCompare(a.date);
	});
	const limit = Math.min(Number(q.limit) || 200, 1000);
	const offset = Number(q.offset) || 0;
	const body: TransactionList = { total: list.length, items: list.slice(offset, offset + limit).map(data.row) };
	return c.json(body);
});

/**
 * Change a transaction's category. scope "one" changes only this transaction;
 * "merchant" changes every transaction of its merchant and remembers the
 * choice for future uploads (merchant_overrides).
 */
insights.patch("/transactions/:id", async (c) => {
	const body = await c.req.json<{ category?: unknown; scope?: unknown }>().catch(() => ({}) as { category?: unknown; scope?: unknown });
	if (!isCategory(body.category)) return c.json({ error: "Unknown category." }, 400);
	const id = c.req.param("id");
	if (body.scope === "merchant") {
		const data = await load(c.env.DB);
		const tx = data.all.find((t) => t.id === id);
		if (!tx) return c.json({ error: "Transaction not found." }, 404);
		const ids = data.all.filter((t) => t.merchant_key === tx.merchant_key).map((t) => t.id);
		await c.env.DB.batch([
			c.env.DB.prepare(
				`INSERT INTO merchant_overrides (merchant_key, merchant, category) VALUES (?, ?, ?)
				 ON CONFLICT (merchant_key) DO UPDATE SET category = excluded.category, merchant = excluded.merchant`,
			).bind(tx.merchant_key, tx.merchant ?? tx.description, body.category),
			...chunks(ids, 90).map((part) =>
				c.env.DB.prepare(
					`UPDATE transactions SET category = ?, category_source = 'user' WHERE id IN (${part.map(() => "?").join(",")})`,
				).bind(body.category, ...part),
			),
		]);
		return c.json({ updated: ids.length });
	}
	const res = await c.env.DB.prepare("UPDATE transactions SET category = ?, category_source = 'user' WHERE id = ?").bind(body.category, id).run();
	if (!res.meta.changes) return c.json({ error: "Transaction not found." }, 404);
	return c.json({ updated: 1 });
});

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

insights.get("/merchants", async (c) => {
	const data = await load(c.env.DB);
	const by = new Map<string, MerchantSummary>();
	for (const t of data.all) {
		const m = by.get(t.merchant_key) ?? { merchant: t.merchant ?? t.description, merchant_key: t.merchant_key, count: 0, spent: 0 };
		m.count++;
		if (t.amount < 0) m.spent = Math.round((m.spent - t.amount) * 100) / 100;
		by.set(t.merchant_key, m);
	}
	return c.json([...by.values()].sort((a, b) => b.count - a.count || a.merchant.localeCompare(b.merchant)));
});

insights.get("/merchants/:key", async (c) => {
	const key = decodeURIComponent(c.req.param("key"));
	const data = await load(c.env.DB);
	const list = data.all.filter((t) => t.merchant_key === key);
	if (!list.length) return c.json({ error: "Merchant not found." }, 404);
	const spentList = list.filter((t) => t.amount < 0);
	const spent = round2(-spentList.reduce((a, t) => a + t.amount, 0));
	const byMonth = new Map<string, number>();
	for (const m of monthsOf(data.all)) byMonth.set(m, 0);
	for (const t of spentList) byMonth.set(monthOf(t.date), round2((byMonth.get(monthOf(t.date)) ?? 0) - t.amount));
	const splitKeys = new Set(data.variants.map((v) => v.variant_key));
	const variants = new Map<string, MerchantVariant>();
	for (const t of list) {
		const v = variants.get(t.variant_key) ?? { variant_key: t.variant_key, example: t.description, raw_merchant: t.raw_merchant, count: 0, total: 0, split: splitKeys.has(t.variant_key) };
		v.count++;
		v.total = round2(v.total + t.amount);
		variants.set(t.variant_key, v);
	}
	const categories = new Map<string, number>();
	for (const t of list) categories.set(t.category, (categories.get(t.category) ?? 0) + 1);
	const body: MerchantDetail = {
		merchant: list[0].merchant ?? list[0].description,
		merchant_key: key,
		category: [...categories.entries()].sort((a, b) => b[1] - a[1])[0][0] as Category,
		currency: mainCurrency(list),
		count: list.length,
		spent,
		received: round2(list.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0)),
		average: spentList.length ? round2(spent / spentList.length) : 0,
		first_date: list[0].date,
		last_date: list.at(-1)!.date,
		by_month: [...byMonth.entries()].map(([month, s]) => ({ month, spent: s })),
		variants: [...variants.values()].sort((a, b) => b.count - a.count),
		transactions: [...list].reverse().map(data.row),
		recurring_rule_id: data.rules.find((r) => r.merchant_key === key)?.id ?? null,
		override: data.overrides.get(key) ?? null,
	};
	return c.json(body);
});

/**
 * Point merchant `fromKey` at (targetKey, targetName): used for rename
 * (target = the new name) and merge (target = another merchant). Every stored
 * key that currently shows as `fromKey` gets an alias, and recurring rules,
 * category overrides and dismissed suggestions move along.
 */
async function repoint(db: D1Database, fromKey: string, targetKey: string, targetName: string, mode: "rename" | "merge") {
	const data = await load(db);
	// Keys after variant rules but before aliases, for everything shown as fromKey.
	const preAlias = resolveMerchants(data.raw, [], data.variants);
	const keys = new Set<string>();
	data.all.forEach((t, i) => {
		if (t.merchant_key === fromKey) keys.add(preAlias[i].merchant_key);
	});
	const statements = [
		db.prepare("UPDATE merchant_aliases SET canonical_key = ?, canonical_name = ? WHERE canonical_key = ?").bind(targetKey, targetName, fromKey),
		// Merging into a merchant that is itself shown under a custom name keeps that name.
		db.prepare("UPDATE merchant_aliases SET canonical_name = ? WHERE canonical_key = ?").bind(targetName, targetKey),
		...[...keys].map((k) =>
			db
				.prepare(
					`INSERT INTO merchant_aliases (alias_key, canonical_key, canonical_name) VALUES (?, ?, ?)
					 ON CONFLICT (alias_key) DO UPDATE SET canonical_key = excluded.canonical_key, canonical_name = excluded.canonical_name`,
				)
				.bind(k, targetKey, targetName),
		),
		db.prepare("UPDATE recurring_rules SET merchant_key = ?, merchant = ? WHERE merchant_key = ?").bind(targetKey, targetName, fromKey),
		db.prepare("UPDATE recurring_rules SET merchant = ? WHERE merchant_key = ?").bind(targetName, targetKey),
		// A rename keeps the merchant's category override; a merge keeps the target's.
		...(mode === "rename"
			? [db.prepare("INSERT OR IGNORE INTO merchant_overrides (merchant_key, merchant, category) SELECT ?, ?, category FROM merchant_overrides WHERE merchant_key = ?").bind(targetKey, targetName, fromKey)]
			: []),
		db.prepare("INSERT OR IGNORE INTO dismissed_recurring_suggestions (merchant_key) SELECT ? FROM dismissed_recurring_suggestions WHERE merchant_key = ?").bind(targetKey, fromKey),
	];
	if (fromKey !== targetKey) {
		statements.push(
			db.prepare("DELETE FROM merchant_overrides WHERE merchant_key = ?").bind(fromKey),
			db.prepare("DELETE FROM dismissed_recurring_suggestions WHERE merchant_key = ?").bind(fromKey),
		);
	}
	await db.batch(statements);
}

insights.post("/merchants/:key/rename", async (c) => {
	const key = decodeURIComponent(c.req.param("key"));
	const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
	const clean = (name ?? "").trim().slice(0, 100);
	if (!clean) return c.json({ error: "Name is required." }, 400);
	const target = merchantKey(clean, clean);
	await repoint(c.env.DB, key, target, clean, "rename");
	return c.json({ merchant_key: target, merchant: clean });
});

insights.post("/merchants/:key/merge", async (c) => {
	const key = decodeURIComponent(c.req.param("key"));
	const { into } = await c.req.json<{ into?: string }>().catch(() => ({ into: undefined }));
	if (!into || into === key) return c.json({ error: "Choose another merchant to merge into." }, 400);
	const data = await load(c.env.DB);
	const target = data.all.find((t) => t.merchant_key === into);
	if (!target) return c.json({ error: "Merchant not found." }, 404);
	await repoint(c.env.DB, key, into, target.merchant ?? target.description, "merge");
	return c.json({ merchant_key: into, merchant: target.merchant });
});

/** Split a name variant off into its own merchant (remembered for future uploads). */
insights.post("/merchants/:key/split", async (c) => {
	const { variant_key, name } = await c.req.json<{ variant_key?: string; name?: string }>().catch(() => ({}) as { variant_key?: string; name?: string });
	const data = await load(c.env.DB);
	const example = data.all.find((t) => t.variant_key === variant_key);
	if (!variant_key || !example) return c.json({ error: "Variant not found." }, 404);
	const clean = (name ?? "").trim().slice(0, 100) || titleCase(variant_key);
	await c.env.DB.prepare(
		`INSERT INTO merchant_variant_rules (variant_key, merchant_name) VALUES (?, ?)
		 ON CONFLICT (variant_key) DO UPDATE SET merchant_name = excluded.merchant_name`,
	)
		.bind(variant_key, clean)
		.run();
	return c.json({ merchant_key: splitKey(clean), merchant: clean });
});

// ---------------------------------------------------------------------------
// Recurring payments
// ---------------------------------------------------------------------------

insights.get("/recurring", async (c) => {
	const data = await load(c.env.DB);
	const subs = subscriptions(data.all, data.rules, data.matches);
	const monthly = round2(subs.reduce((a, s) => a + s.monthly, 0));
	const body: RecurringOverview = {
		currency: data.currency,
		subscriptions: subs,
		suggestions: recurringSuggestions(data.all, data.rules, data.dismissedSuggestions),
		monthly_total: monthly,
		yearly_total: round2(monthly * 12),
	};
	return c.json(body);
});

/** Mark as monthly recurring: from a transaction, or a suggestion's merchant and amount. */
insights.post("/recurring", async (c) => {
	const body = await c.req
		.json<{ transaction_id?: string; merchant_key?: string; amount?: number; tolerance?: number }>()
		.catch(() => ({}) as { transaction_id?: string; merchant_key?: string; amount?: number; tolerance?: number });
	const data = await load(c.env.DB);
	const tx = body.transaction_id ? data.all.find((t) => t.id === body.transaction_id) : data.all.find((t) => t.merchant_key === body.merchant_key);
	if (!tx) return c.json({ error: "Transaction not found." }, 404);
	const amount = body.amount ?? -tx.amount;
	if (!(amount > 0)) return c.json({ error: "Only money going out can be marked as a recurring payment." }, 400);
	const tolerance = Math.min(Math.max(body.tolerance ?? 0.1, 0.01), 0.5);
	const existing = data.rules.find((r) => r.merchant_key === tx.merchant_key);
	if (existing) {
		await c.env.DB.prepare("UPDATE recurring_rules SET amount = ?, tolerance = ? WHERE id = ?").bind(amount, tolerance, existing.id).run();
		return c.json({ id: existing.id });
	}
	const row = await c.env.DB.prepare(
		"INSERT INTO recurring_rules (merchant_key, merchant, amount, tolerance, category) VALUES (?, ?, ?, ?, ?) RETURNING id",
	)
		.bind(tx.merchant_key, tx.merchant ?? tx.description, amount, tolerance, tx.category)
		.first<{ id: number }>();
	return c.json({ id: row?.id }, 201);
});

insights.delete("/recurring/:id", async (c) => {
	await c.env.DB.prepare("DELETE FROM recurring_rules WHERE id = ?").bind(Number(c.req.param("id"))).run();
	return c.body(null, 204);
});

insights.post("/recurring/suggestions/:key/dismiss", async (c) => {
	await c.env.DB.prepare("INSERT OR IGNORE INTO dismissed_recurring_suggestions (merchant_key) VALUES (?)")
		.bind(decodeURIComponent(c.req.param("key")))
		.run();
	return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

insights.get("/budgets", async (c) => {
	const [data, budgets] = await Promise.all([load(c.env.DB), loadBudgets(c.env.DB)]);
	const body: BudgetOverview = { currency: data.currency, budgets, months: budgetReport(data.all, budgets) };
	return c.json(body);
});

/** Set (amount > 0) or remove (amount null) a monthly budget; category "*" is the overall budget. */
insights.put("/budgets/:category", async (c) => {
	const category = decodeURIComponent(c.req.param("category"));
	if (category !== "*" && !isCategory(category)) return c.json({ error: "Unknown category." }, 400);
	const { amount } = await c.req.json<{ amount?: number | null }>().catch(() => ({ amount: undefined }));
	if (amount === null || amount === 0) {
		await c.env.DB.prepare("DELETE FROM budgets WHERE category = ?").bind(category).run();
	} else if (typeof amount === "number" && amount > 0 && Number.isFinite(amount)) {
		await c.env.DB.prepare(
			`INSERT INTO budgets (category, amount) VALUES (?, ?)
			 ON CONFLICT (category) DO UPDATE SET amount = excluded.amount, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
			.bind(category, round2(amount))
			.run();
	} else {
		return c.json({ error: "Amount must be a positive number, or null to remove the budget." }, 400);
	}
	return c.json({ budgets: await loadBudgets(c.env.DB) });
});

async function loadBudgets(db: D1Database): Promise<Budgets> {
	const { results } = await db.prepare("SELECT category, amount FROM budgets").all<{ category: string; amount: number }>();
	return Object.fromEntries(results.map((b) => [b.category, b.amount]));
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

insights.post("/flags/dismiss", async (c) => {
	const { transaction_id, code } = await c.req.json<{ transaction_id?: string; code?: string }>().catch(() => ({}) as { transaction_id?: string; code?: string });
	if (!transaction_id || !code) return c.json({ error: "transaction_id and code are required." }, 400);
	await c.env.DB.prepare("INSERT OR IGNORE INTO flag_dismissals (transaction_id, code) VALUES (?, ?)").bind(transaction_id, code).run();
	return c.body(null, 204);
});

// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

function chunks<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

function titleCase(s: string): string {
	return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
