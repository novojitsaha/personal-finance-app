// data_version and the tool-result cache. data_version goes up whenever the
// financial data changes; a cached tool result is only used while the version
// it was computed for is current, so answers never use stale numbers.
import type { Data } from "./data";
import type { FinanceTool } from "./tools";

export async function dataVersion(db: D1Database): Promise<number> {
	const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'data_version'").first<{ value: number }>();
	return row?.value ?? 0;
}

/** Mark the data as changed: bumps data_version and drops cached tool results. */
export async function bumpDataVersion(db: D1Database): Promise<void> {
	await db.batch([
		db.prepare("INSERT INTO app_meta (key, value) VALUES ('data_version', 1) ON CONFLICT (key) DO UPDATE SET value = value + 1"),
		db.prepare("DELETE FROM tool_cache"),
	]);
}

/** Arguments as JSON with sorted keys and no empty values, so equal calls share a key. */
export function cacheKey(tool: string, input: unknown): string {
	const clean = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(clean);
		if (v && typeof v === "object") {
			return Object.fromEntries(
				Object.entries(v as Record<string, unknown>)
					.filter(([, x]) => x !== undefined && x !== null && x !== "")
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, x]) => [k, clean(x)]),
			);
		}
		return v;
	};
	return `${tool}:${JSON.stringify(clean(input ?? {}))}`;
}

export interface ToolCallContext {
	db: D1Database;
	source: "chat" | "mcp";
	conversationId?: string;
	/** Loads the data at most once per question. */
	data: () => Promise<Data>;
}

/** Run a tool through the cache, and log the call for hit-rate stats. */
export async function runCached(tool: FinanceTool, input: unknown, ctx: ToolCallContext): Promise<unknown> {
	const { db } = ctx;
	const parsed = tool.inputSchema.parse(input ?? {});
	const key = cacheKey(tool.name, parsed);
	const version = await dataVersion(db);
	const cacheable = tool.cache !== false;
	const hit = cacheable
		? await db.prepare("SELECT result FROM tool_cache WHERE key = ? AND data_version = ?").bind(key, version).first<{ result: string }>()
		: null;
	let result: unknown;
	if (hit) {
		result = JSON.parse(hit.result);
	} else {
		result = await tool.execute(await ctx.data(), parsed as never, db);
		if (cacheable) await db
			.prepare(
				`INSERT INTO tool_cache (key, data_version, result) VALUES (?, ?, ?)
				 ON CONFLICT (key) DO UPDATE SET data_version = excluded.data_version, result = excluded.result, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
			)
			.bind(key, version, JSON.stringify(result))
			.run();
	}
	await db
		.prepare("INSERT INTO tool_calls (tool, source, cache_hit, conversation_id) VALUES (?, ?, ?, ?)")
		.bind(tool.name, ctx.source, hit ? 1 : 0, ctx.conversationId ?? null)
		.run();
	return result;
}
