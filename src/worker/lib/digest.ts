// Monthly digests: facts computed from the data (no AI) plus a short summary
// the AI writes from them. A digest is regenerated only when its month's facts
// change, so unrelated edits don't cost an AI call.
import type { Digest } from "../../shared/api";
import { type AiContext, writeDigest } from "./ai";
import { addMonths, kpis, monthOf, months as monthsOf, spendingByCategory, subscriptions, topMerchants } from "./analytics";
import { type Data, load } from "./data";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function digestFacts(data: Data, month: string) {
	const inMonth = data.all.filter((t) => monthOf(t.date) === month);
	const prevMonth = addMonths(month, -1);
	const prev = data.all.filter((t) => monthOf(t.date) === prevMonth);
	const now = new Map(spendingByCategory(inMonth).map((c) => [c.category, c.amount]));
	const before = new Map(spendingByCategory(prev).map((c) => [c.category, c.amount]));
	const changes = [...new Set([...now.keys(), ...before.keys()])]
		.map((c) => ({ category: c, now: now.get(c) ?? 0, before: before.get(c) ?? 0, change: r2((now.get(c) ?? 0) - (before.get(c) ?? 0)) }))
		.filter((c) => Math.abs(c.change) >= 10)
		.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
		.slice(0, 4);
	// Merchants paid for the first time this month (at least €20 in total).
	const firstSeen = new Map<string, string>();
	for (const t of data.all) if (!firstSeen.has(t.merchant_key)) firstSeen.set(t.merchant_key, t.date);
	const newMerchants = topMerchants(inMonth, 50)
		.filter((m) => monthOf(firstSeen.get(m.merchant_key) ?? "") === month && m.amount >= 20 && monthsOf(data.all)[0] !== month)
		.slice(0, 4)
		.map((m) => ({ merchant: m.merchant, amount: m.amount }));
	const subs = subscriptions(data.all, data.rules, data.matches)
		.filter((s) => s.warnings.length)
		.map((s) => ({ merchant: s.merchant, warnings: s.warnings.map((w) => w.message) }));
	const flagged = inMonth.filter((t) => data.flagMap.has(t.id));
	return {
		month,
		currency: data.currency,
		complete: monthsOf(data.all).at(-1) !== month,
		totals: kpis(inMonth),
		previous_month: prev.length ? { month: prevMonth, totals: kpis(prev) } : null,
		top_categories: spendingByCategory(inMonth)
			.slice(0, 5)
			.map((c) => ({ category: c.category, amount: c.amount, share: r2(c.share) })),
		biggest_changes: changes,
		top_merchants: topMerchants(inMonth, 5).map((m) => ({ merchant: m.merchant, amount: m.amount })),
		new_merchants: newMerchants,
		subscription_warnings: subs,
		unusual_charges: {
			count: flagged.length,
			examples: flagged.slice(0, 3).map((t) => ({ date: t.date, merchant: t.merchant ?? t.description, amount: t.amount, reason: data.flagMap.get(t.id)![0].reason })),
		},
	};
}
export type DigestFacts = ReturnType<typeof digestFacts>;

interface Row {
	month: string;
	facts: string;
	summary: string;
	created_at: string;
}

/** The stored digest for a month, and whether its facts are still current. */
export async function getDigest(db: D1Database, month: string, data?: Data): Promise<Digest | null> {
	const row = await db.prepare("SELECT month, facts, summary, created_at FROM digests WHERE month = ?").bind(month).first<Row>();
	if (!row) return null;
	const d = data ?? (await load(db));
	const current = JSON.stringify(digestFacts(d, month));
	return { month, summary: row.summary, facts: JSON.parse(row.facts), created_at: row.created_at, stale: current !== row.facts };
}

/**
 * Write (or rewrite) the digests of the given months whose facts changed.
 * Months without transactions are skipped. Returns the months written.
 */
export async function refreshDigests(ctx: AiContext & { db: D1Database }, months: string[]): Promise<string[]> {
	const data = await load(ctx.db);
	const have = new Set(monthsOf(data.all));
	const written: string[] = [];
	for (const month of [...new Set(months)].filter((m) => have.has(m))) {
		const facts = digestFacts(data, month);
		const json = JSON.stringify(facts);
		const row = await ctx.db.prepare("SELECT facts FROM digests WHERE month = ?").bind(month).first<{ facts: string }>();
		if (row?.facts === json) continue;
		const summary = await writeDigest(ctx, facts);
		await ctx.db
			.prepare(
				`INSERT INTO digests (month, data_version, facts, summary) VALUES (?, (SELECT value FROM app_meta WHERE key = 'data_version'), ?, ?)
				 ON CONFLICT (month) DO UPDATE SET data_version = excluded.data_version, facts = excluded.facts, summary = excluded.summary, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
			)
			.bind(month, json, summary)
			.run();
		written.push(month);
	}
	return written;
}
