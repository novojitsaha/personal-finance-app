// Tool-result cache hit rates (AI usage page): how often the chat and the MCP
// server got a tool's answer from the cache instead of recomputing it.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UsageOverview } from "../../shared/api";

export function ToolCacheCard({ stats }: { stats: UsageOverview["tool_cache"] }) {
	const total = stats.reduce((a, s) => a + s.calls, 0);
	const hits = stats.reduce((a, s) => a + s.hits, 0);
	return (
		<Card>
			<CardHeader>
				<CardTitle>Tool cache</CardTitle>
				<CardDescription>
					Data lookups answered from the cache. Cached results are dropped whenever your data changes (an upload, a delete, a category or merchant change), so answers never use old numbers.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{total === 0 ? (
					<p className="text-sm text-muted-foreground">No data lookups yet.</p>
				) : (
					<dl className="grid gap-4 sm:grid-cols-3">
						<div>
							<dt className="text-sm text-muted-foreground">All lookups</dt>
							<dd className="text-2xl font-semibold tabular-nums">{Math.round((hits / total) * 100)}%</dd>
							<dd className="text-xs text-muted-foreground">
								{hits} of {total} from cache
							</dd>
						</div>
						{stats.map((s) => (
							<div key={s.source}>
								<dt className="text-sm text-muted-foreground">{s.source === "mcp" ? "MCP server" : "Chat"}</dt>
								<dd className="text-2xl font-semibold tabular-nums">{Math.round(s.hit_rate * 100)}%</dd>
								<dd className="text-xs text-muted-foreground">
									{s.hits} of {s.calls} from cache
								</dd>
							</div>
						))}
					</dl>
				)}
			</CardContent>
		</Card>
	);
}
