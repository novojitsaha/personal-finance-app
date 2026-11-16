// AI usage and cost: every Workers AI call (statement extraction,
// categorization, chat, summaries) is recorded with its tokens and cost.
// Charts follow the shadcn chart gallery: Bar Chart - Stacked + Legend and
// Bar Chart - Horizontal.
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, FileText, MessageSquare, Sigma } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataTable, SortHeader } from "@/components/data-table";
import { useTheme } from "@/components/theme-provider";
import { useChartMotion } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ToolCacheCard } from "@/components/tool-cache-card";
import { getUsage } from "@/api";
import { formatDate, monthLabel, usd } from "@/format";
import { href } from "@/router";
import type { UsageCall, UsageOverview } from "../../shared/api";

const FEATURES = {
	extraction: { label: "Statement reading", theme: { light: "oklch(0.6 0.15 250)", dark: "oklch(0.7 0.14 250)" } },
	categorization: { label: "Categorization", theme: { light: "oklch(0.65 0.15 150)", dark: "oklch(0.72 0.15 150)" } },
	chat: { label: "Chat", theme: { light: "oklch(0.65 0.17 30)", dark: "oklch(0.72 0.16 30)" } },
	summary: { label: "Conversation summaries", theme: { light: "oklch(0.7 0.14 85)", dark: "oklch(0.78 0.13 85)" } },
	highlights: { label: "Highlights", theme: { light: "oklch(0.6 0.16 310)", dark: "oklch(0.7 0.15 310)" } },
	digest: { label: "Monthly digests", theme: { light: "oklch(0.6 0.1 200)", dark: "oklch(0.72 0.1 200)" } },
} satisfies ChartConfig;
type Feature = keyof typeof FEATURES;
const featureLabel = (f: string) => FEATURES[f as Feature]?.label ?? f;

export function Usage() {
	const [data, setData] = useState<UsageOverview | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		getUsage().then(setData, (e: Error) => setError(e.message));
	}, []);
	if (error) return <p className="text-destructive">{error}</p>;
	if (!data) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-10 w-64" />
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					{[0, 1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-32" />
					))}
				</div>
				<Skeleton className="h-80" />
			</div>
		);
	}
	return (
		<div className="stagger space-y-4 md:space-y-5">
			<PageHeader
				title="AI usage"
				description="Every AI call the app makes, with its cost in US dollars (Workers AI bills in USD). Statements read by the bunq and Revolut parsers only use AI for categories."
				className="animate-none"
			/>
			<Kpis data={data} />
			<CostChart data={data} />
			<div className="grid gap-4 md:gap-5 lg:grid-cols-2">
				<ByFeature data={data} />
				<ChatCard data={data} />
			</div>
			<ToolCacheCard stats={data.tool_cache} />
			<RecentCalls calls={data.recent} />
		</div>
	);
}

function Kpis({ data }: { data: UsageOverview }) {
	return (
		<div className="grid gap-4 sm:grid-cols-2 md:gap-5 xl:grid-cols-4">
			<StatCard index={0} label={`This month (${monthLabel(data.this_month.month, "short")})`} icon={CalendarDays} value={data.this_month.cost} format={usd} note={`${data.this_month.calls} AI calls`} />
			<StatCard index={1} label="All time" icon={Sigma} tone="neutral" value={data.all_time.cost} format={usd} note={`${data.all_time.calls} AI calls`} />
			<StatCard index={2} label="Chat" icon={MessageSquare} tone="positive" value={data.chat.cost} format={usd} note={`${data.chat.conversations} conversations · ${data.chat.messages} questions`} />
			<StatCard
				index={3}
				label="Per statement"
				icon={FileText}
				tone="warning"
				value={data.statements.avg_cost ?? 0}
				format={(n) => (data.statements.avg_cost == null ? "—" : usd(n))}
				note={`Average over ${data.statements.count} statement${data.statements.count === 1 ? "" : "s"}`}
			/>
		</div>
	);
}

function CostChart({ data }: { data: UsageOverview }) {
	const motion = useChartMotion();
	const [range, setRange] = useState<"days" | "months">("days");
	const rows = useMemo(
		() => (range === "days" ? data.by_day : data.by_month).map((p) => ({ period: p.period, total: p.total, ...p.by_feature })),
		[data, range],
	);
	const used = useMemo(() => {
		const keys = new Set<string>();
		for (const p of [...data.by_day, ...data.by_month]) for (const k of Object.keys(p.by_feature)) keys.add(k);
		return (Object.keys(FEATURES) as Feature[]).filter((k) => keys.has(k));
	}, [data]);
	const label = (p: string) => (range === "days" ? formatDate(p) : monthLabel(p));
	return (
		<Card>
			<CardHeader className="flex flex-wrap items-start justify-between gap-2 space-y-0">
				<div>
					<CardTitle>Cost over time</CardTitle>
					<CardDescription>{range === "days" ? "Last 30 days" : "Per month"}, by feature</CardDescription>
				</div>
				<ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={(v) => v && setRange(v as "days" | "months")}>
					<ToggleGroupItem value="days">Days</ToggleGroupItem>
					<ToggleGroupItem value="months">Months</ToggleGroupItem>
				</ToggleGroup>
			</CardHeader>
			<CardContent>
				{used.length === 0 ? (
					<p className="py-10 text-center text-sm text-muted-foreground">No AI calls recorded yet.</p>
				) : (
					<ChartContainer config={FEATURES} className="aspect-auto h-[260px] w-full">
						<BarChart accessibilityLayer data={rows}>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="period"
								tickLine={false}
								axisLine={false}
								tickMargin={10}
								minTickGap={24}
								tickFormatter={(p: string) => (range === "days" ? new Date(`${p}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : monthLabel(p, "short"))}
							/>
							<YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => usd(v)} />
							<ChartTooltip
								cursor={false}
								content={
									<ChartTooltipContent
										labelFormatter={(_, payload) => label(String(payload?.[0]?.payload?.period ?? ""))}
										formatter={(value, name) => (
											<div className="flex w-full justify-between gap-4">
												<span className="text-muted-foreground">{featureLabel(String(name))}</span>
												<span className="font-mono tabular-nums">{usd(Number(value))}</span>
											</div>
										)}
									/>
								}
							/>
							<ChartLegend content={<ChartLegendContent />} />
							{used.map((k, i) => (
								<Bar key={k} dataKey={k} stackId="cost" fill={`var(--color-${k})`} radius={i === used.length - 1 ? [4, 4, 0, 0] : 0} {...motion} />
							))}
						</BarChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}

function ByFeature({ data }: { data: UsageOverview }) {
	const total = data.all_time.cost || 1;
	const { resolved } = useTheme();
	const color = (f: string) => FEATURES[f as Feature]?.theme[resolved === "dark" ? "dark" : "light"] ?? "var(--muted-foreground)";
	return (
		<Card>
			<CardHeader>
				<CardTitle>By feature</CardTitle>
				<CardDescription>All time</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{data.by_feature.length === 0 && <p className="text-sm text-muted-foreground">No AI calls recorded yet.</p>}
				{data.by_feature.map((f) => (
					<div key={f.feature} className="space-y-1">
						<div className="flex items-center justify-between gap-2 text-sm">
							<span className="flex items-center gap-2">
								<span className="size-2.5 rounded-sm" style={{ background: color(f.feature) }} />
								{featureLabel(f.feature)}
							</span>
							<span className="tabular-nums">{usd(f.cost)}</span>
						</div>
						<div className="h-2 overflow-hidden rounded-full bg-muted">
							<div className="h-full rounded-full" style={{ width: `${Math.max(1, (f.cost / total) * 100)}%`, background: color(f.feature) }} />
						</div>
						<p className="text-xs text-muted-foreground">
							{f.calls} calls · {f.input_tokens.toLocaleString()} tokens in · {f.output_tokens.toLocaleString()} tokens out
						</p>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

function ChatCard({ data }: { data: UsageOverview }) {
	const c = data.chat;
	const rows = [
		["Conversations", c.conversations.toLocaleString()],
		["Questions asked", c.messages.toLocaleString()],
		["Average per conversation", usd(c.avg_per_conversation)],
		["Average per question", usd(c.avg_per_message)],
		["Average per statement", usd(data.statements.avg_cost)],
	];
	return (
		<Card>
			<CardHeader>
				<CardTitle>Chat and statements</CardTitle>
				<CardDescription>Averages, all time</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="divide-y text-sm">
					{rows.map(([k, v]) => (
						<div key={k} className="flex justify-between py-2">
							<dt className="text-muted-foreground">{k}</dt>
							<dd className="tabular-nums">{v}</dd>
						</div>
					))}
				</dl>
			</CardContent>
		</Card>
	);
}

const columns: ColumnDef<UsageCall, unknown>[] = [
	{
		accessorKey: "created_at",
		header: ({ column }) => <SortHeader column={column} title="Time" />,
		cell: ({ row }) => new Date(row.original.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
	},
	{
		accessorKey: "feature",
		header: "Feature",
		cell: ({ row }) => (
			<span className="flex items-center gap-2">
				{featureLabel(row.original.feature)}
				{row.original.task !== row.original.feature && <span className="text-xs text-muted-foreground">{row.original.task}</span>}
				{!row.original.ok && <Badge variant="destructive">rejected</Badge>}
			</span>
		),
	},
	{
		id: "for",
		header: "For",
		cell: ({ row }) =>
			row.original.statement_id ? (
				<a className="underline-offset-4 hover:underline" href={href("/statements")}>
					{row.original.filename ?? "Deleted statement"}
				</a>
			) : row.original.conversation_id ? (
				"Chat"
			) : (
				"—"
			),
	},
	{
		accessorKey: "input_tokens",
		header: ({ column }) => <SortHeader column={column} title="Tokens in" align="right" />,
		cell: ({ row }) => <div className="text-right tabular-nums">{row.original.input_tokens.toLocaleString()}</div>,
	},
	{
		accessorKey: "output_tokens",
		header: ({ column }) => <SortHeader column={column} title="Tokens out" align="right" />,
		cell: ({ row }) => <div className="text-right tabular-nums">{row.original.output_tokens.toLocaleString()}</div>,
	},
	{
		accessorKey: "cost_usd",
		header: ({ column }) => <SortHeader column={column} title="Cost" align="right" />,
		cell: ({ row }) => <div className="text-right tabular-nums">{usd(row.original.cost_usd)}</div>,
	},
];

function RecentCalls({ calls }: { calls: UsageCall[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent AI calls</CardTitle>
				<CardDescription>The latest 50</CardDescription>
			</CardHeader>
			<CardContent>
				<DataTable columns={columns} data={calls} pageSize={10} empty="No AI calls recorded yet." />
			</CardContent>
		</Card>
	);
}
