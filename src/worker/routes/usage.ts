// AI usage and cost, from the ai_usage table (one row per Workers AI call).
import { Hono } from "hono";
import type { UsageOverview } from "../../shared/api";

type Env = { Bindings: Cloudflare.Env };
export const usage = new Hono<Env>();

const r6 = (n: number | null | undefined) => Math.round((n ?? 0) * 1e6) / 1e6;

usage.get("/", async (c) => {
	const db = c.env.DB;
	const thisMonth = new Date().toISOString().slice(0, 7);
	const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
	const [totals, byFeature, byMonth, byDay, chat, perStatement, recent, cache] = await db.batch([
		db.prepare(
			`SELECT count(*) AS calls, sum(cost_usd) AS cost,
			        sum(CASE WHEN substr(created_at, 1, 7) = ?1 THEN cost_usd ELSE 0 END) AS month_cost,
			        sum(CASE WHEN substr(created_at, 1, 7) = ?1 THEN 1 ELSE 0 END) AS month_calls
			 FROM ai_usage`,
		).bind(thisMonth),
		db.prepare(
			`SELECT feature, count(*) AS calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens, sum(cost_usd) AS cost
			 FROM ai_usage GROUP BY feature ORDER BY cost DESC`,
		),
		db.prepare(`SELECT substr(created_at, 1, 7) AS period, feature, sum(cost_usd) AS cost FROM ai_usage GROUP BY 1, 2 ORDER BY 1`),
		db.prepare(`SELECT substr(created_at, 1, 10) AS period, feature, sum(cost_usd) AS cost FROM ai_usage WHERE created_at >= ? GROUP BY 1, 2 ORDER BY 1`).bind(since),
		db.prepare(
			`SELECT count(DISTINCT conversation_id) AS conversations, count(DISTINCT message_id) AS messages, sum(cost_usd) AS cost
			 FROM ai_usage WHERE feature = 'chat' AND conversation_id IS NOT NULL`,
		),
		db.prepare(`SELECT count(*) AS statements, avg(cost) AS avg_cost FROM (SELECT sum(cost_usd) AS cost FROM ai_usage WHERE statement_id IS NOT NULL GROUP BY statement_id)`),
		db.prepare(
			`SELECT u.id, u.created_at, u.feature, u.task, u.model, u.input_tokens, u.output_tokens, u.cost_usd, u.ok, u.statement_id, u.conversation_id, s.filename
			 FROM ai_usage u LEFT JOIN statements s ON s.id = u.statement_id ORDER BY u.id DESC LIMIT 50`,
		),
		db.prepare(`SELECT source, count(*) AS calls, sum(cache_hit) AS hits FROM tool_calls GROUP BY source`),
	]);
	const t = totals.results[0] as { calls: number; cost: number | null; month_cost: number | null; month_calls: number | null };
	const ch = chat.results[0] as { conversations: number; messages: number; cost: number | null };
	const ps = perStatement.results[0] as { statements: number; avg_cost: number | null };
	const series = (rows: { period: string; feature: string; cost: number }[]) => {
		const map = new Map<string, Record<string, number>>();
		for (const r of rows) {
			const p = map.get(r.period) ?? {};
			p[r.feature] = r6(r.cost);
			map.set(r.period, p);
		}
		return [...map.entries()].map(([period, by_feature]) => ({ period, by_feature, total: r6(Object.values(by_feature).reduce((a, b) => a + b, 0)) }));
	};
	// Fill missing days so the daily chart has a continuous axis.
	const dayRows = series(byDay.results as never);
	const days: typeof dayRows = [];
	for (let i = 29; i >= 0; i--) {
		const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
		days.push(dayRows.find((r) => r.period === d) ?? { period: d, by_feature: {}, total: 0 });
	}
	const body: UsageOverview = {
		currency: "USD",
		this_month: { month: thisMonth, cost: r6(t.month_cost), calls: t.month_calls ?? 0 },
		all_time: { cost: r6(t.cost), calls: t.calls },
		by_feature: (byFeature.results as { feature: string; calls: number; input_tokens: number; output_tokens: number; cost: number }[]).map((f) => ({ ...f, cost: r6(f.cost) })),
		by_month: series(byMonth.results as never),
		by_day: days,
		chat: {
			conversations: ch.conversations,
			messages: ch.messages,
			cost: r6(ch.cost),
			avg_per_conversation: ch.conversations ? r6((ch.cost ?? 0) / ch.conversations) : null,
			avg_per_message: ch.messages ? r6((ch.cost ?? 0) / ch.messages) : null,
		},
		statements: { count: ps.statements, avg_cost: ps.statements ? r6(ps.avg_cost) : null },
		tool_cache: (cache.results as { source: "chat" | "mcp"; calls: number; hits: number }[]).map((r) => ({ ...r, hit_rate: r.calls ? r.hits / r.calls : 0 })),
		recent: (recent.results as UsageOverview["recent"]).map((r) => ({ ...r, ok: !!r.ok, cost_usd: r6(r.cost_usd) })),
	};
	return c.json(body);
});
