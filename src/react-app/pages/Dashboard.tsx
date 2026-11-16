// Dashboard. Charts are adapted from the shadcn chart gallery
// (https://ui.shadcn.com/charts): Area Chart - Interactive (trend), Bar Chart -
// Multiple (income vs spending), Pie Chart - Donut with Text (categories),
// Bar Chart - Negative, horizontal (change vs last month) and Bar Chart -
// Custom Label, horizontal (top merchants).
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryDot } from "@/components/category-badge";
import { AiSummary } from "@/components/ai-summary";
import { FLAG_LABELS } from "@/components/flag-badges";
import { getDashboard } from "@/api";
import { money, monthLabel, percent, formatDate } from "@/format";
import { href, merchantHref, navigate } from "@/router";
import { CHANGE_COLORS, OTHER_SLICE, categoryChartConfig, categoryKey, groupChartConfig, groupKey } from "@/theme";
import { GROUPS } from "../../shared/categories";
import type { Dashboard as DashboardData, DashboardKpis } from "../../shared/api";

export function PeriodSelect({ months, value, onChange }: { months: string[]; value: string; onChange: (v: string) => void }) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger className="w-[170px]" aria-label="Period">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">All time</SelectItem>
				{[...months].reverse().map((m) => (
					<SelectItem key={m} value={m}>
						{monthLabel(m)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function Dashboard({ params }: { params: URLSearchParams }) {
	const [data, setData] = useState<DashboardData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const period = params.get("period");

	useEffect(() => {
		let cancelled = false;
		getDashboard(period).then(
			(d) => !cancelled && setData(d),
			(e: Error) => !cancelled && setError(e.message),
		);
		return () => {
			cancelled = true;
		};
	}, [period]);

	if (error) return <p className="text-destructive">{error}</p>;
	if (!data) return <DashboardSkeleton />;
	if (!data.months.length) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>No transactions yet</CardTitle>
					<CardDescription>Upload a bank statement to see your spending.</CardDescription>
				</CardHeader>
				<CardFooter>
					<Button asChild>
						<a href={href("/statements")}>Upload statements</a>
					</Button>
				</CardFooter>
			</Card>
		);
	}

	const c = data.currency;
	const isMonth = data.period !== "all";
	const txLink = (extra: Record<string, string>) => href("/transactions", { ...(isMonth ? { month: data.period } : {}), ...extra });

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<div className="mr-auto">
					<h1 className="text-2xl font-semibold tracking-tight">{monthLabel(data.period)}</h1>
					<p className="text-sm text-muted-foreground">
						Transfers between your own accounts and to friends are left out of spending and income.
					</p>
				</div>
				<PeriodSelect months={data.months} value={data.period} onChange={(v) => navigate("/", { period: v })} />
			</div>

			<KpiCards kpis={data.kpis} previous={data.previous} currency={c} />

			{isMonth && <AiSummary month={data.period} />}

			<div className="grid gap-4 lg:grid-cols-5">
				<CategoryDonut data={data} className="lg:col-span-2" onSelect={(cat) => navigate("/transactions", { ...(isMonth ? { month: data.period } : {}), category: cat })} />
				<CategoryList data={data} className="lg:col-span-3" link={(cat) => txLink({ category: cat })} />
			</div>

			<SpendingTrend data={data} />

			<div className="grid gap-4 lg:grid-cols-2">
				<IncomeVsSpending data={data} />
				{isMonth ? <CategoryChange data={data} /> : <TopMerchants data={data} />}
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				{isMonth && <TopMerchants data={data} />}
				<FlaggedCard data={data} link={txLink({ flagged: "1" })} />
			</div>
		</div>
	);
}

function DashboardSkeleton() {
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

// ---------------------------------------------------------------------------

function change(now: number, before: number | undefined) {
	if (before === undefined || before === 0) return null;
	return (now - before) / Math.abs(before);
}

function Trend({ value, goodWhenDown }: { value: number | null; goodWhenDown?: boolean }) {
	if (value === null) return null;
	const flat = Math.abs(value) < 0.005;
	const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
	const good = flat ? null : goodWhenDown ? value < 0 : value > 0;
	return (
		<Badge variant="outline" className={good === null ? "" : good ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
			<Icon />
			{flat ? "0%" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(0)}%`}
		</Badge>
	);
}

function KpiCards({ kpis, previous, currency }: { kpis: DashboardKpis; previous: DashboardKpis | null; currency: string }) {
	const items = [
		{ label: "Spent", value: kpis.spent, prev: previous?.spent, goodWhenDown: true, note: "Excludes transfers" },
		{ label: "Income", value: kpis.income, prev: previous?.income, note: "Salary, interest, refunds" },
		{ label: "Net", value: kpis.net, prev: previous?.net, note: kpis.net >= 0 ? "Saved this period" : "Spent more than earned" },
		{
			label: "Transfers (not counted)",
			value: kpis.transfers_out,
			prev: undefined,
			note: `${money(kpis.transfers_out, currency)} out · ${money(kpis.transfers_in, currency)} in`,
		},
	];
	return (
		<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			{items.map((k) => (
				<Card key={k.label} className="@container/card">
					<CardHeader>
						<CardDescription>{k.label}</CardDescription>
						<CardTitle className="text-2xl font-semibold tabular-nums">{money(k.value, currency)}</CardTitle>
						<CardAction>
							<Trend value={change(k.value, k.prev)} goodWhenDown={k.goodWhenDown} />
						</CardAction>
					</CardHeader>
					<CardFooter className="text-sm text-muted-foreground">
						{k.prev !== undefined && previous ? `${k.note} · vs ${money(k.prev, currency)} last month` : k.note}
					</CardFooter>
				</Card>
			))}
		</div>
	);
}

// --- Pie Chart - Donut with Text -------------------------------------------

const TOP_SLICES = 6;

function CategoryDonut({ data, className, onSelect }: { data: DashboardData; className?: string; onSelect: (category: string) => void }) {
	const { slices, config, total } = useMemo(() => {
		const top = data.by_category.slice(0, TOP_SLICES);
		const rest = data.by_category.slice(TOP_SLICES);
		const slices: { key: string; category: string; amount: number; fill: string }[] = top.map((cat) => ({
			key: categoryKey(cat.category),
			category: cat.category,
			amount: cat.amount,
			fill: `var(--color-${categoryKey(cat.category)})`,
		}));
		if (rest.length) {
			slices.push({ key: "other-categories", category: "", amount: rest.reduce((a, r) => a + r.amount, 0), fill: "var(--color-other-categories)" });
		}
		const config = { amount: { label: "Spent" }, ...categoryChartConfig, "other-categories": OTHER_SLICE } satisfies ChartConfig;
		return { slices, config, total: data.kpis.spent };
	}, [data]);

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Spending by category</CardTitle>
				<CardDescription>Top {TOP_SLICES} categories, the rest grouped</CardDescription>
			</CardHeader>
			<CardContent className="flex-1 pb-0">
				<ChartContainer config={config} className="mx-auto aspect-square max-h-[280px]">
					<PieChart>
						<ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="key" formatter={(v, _n, item) => <TooltipRow label={config[item.payload.key as keyof typeof config]?.label as string} value={money(Number(v), data.currency)} color={item.payload.fill} />} />} />
						<Pie
							data={slices}
							dataKey="amount"
							nameKey="key"
							innerRadius={68}
							strokeWidth={4}
							isAnimationActive={false}
							onClick={(s: { payload?: { category?: string } }) => s.payload?.category && onSelect(s.payload.category)}
							className="cursor-pointer"
						>
							<Label
								content={({ viewBox }) =>
									viewBox && "cx" in viewBox && "cy" in viewBox ? (
										<text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
											<tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-xl font-bold">
												{money(total, data.currency, { compact: total >= 10000 })}
											</tspan>
											<tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 22} className="fill-muted-foreground text-xs">
												spent
											</tspan>
										</text>
									) : null
								}
							/>
						</Pie>
					</PieChart>
				</ChartContainer>
			</CardContent>
			<CardFooter className="flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
				{slices.map((s) => (
					<span key={s.key} className="inline-flex items-center gap-1.5">
						<span className="size-2.5 rounded-[3px]" style={{ background: `var(--cat-${s.key})`, ...(s.key === "other-categories" ? { background: "var(--muted-foreground)" } : {}) }} />
						{s.category || "Other categories"}
					</span>
				))}
			</CardFooter>
		</Card>
	);
}

function TooltipRow({ label, value, color }: { label: string; value: string; color?: string }) {
	return (
		<div className="flex w-full items-center gap-2">
			<span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
			<span className="text-muted-foreground">{label}</span>
			<span className="ml-auto font-mono font-medium tabular-nums">{value}</span>
		</div>
	);
}

function CategoryList({ data, className, link }: { data: DashboardData; className?: string; link: (category: string) => string }) {
	const max = Math.max(...data.by_category.map((c) => c.amount), 1);
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>All categories</CardTitle>
				<CardDescription>Click a category to see its transactions</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="space-y-1">
					{data.by_category.map((cat) => (
						<li key={cat.category}>
							<a href={link(cat.category)} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
								<span className="flex items-center gap-2 truncate">
									<CategoryDot category={cat.category} />
									<span className="truncate">{cat.category}</span>
								</span>
								<span className="h-2 rounded-full bg-muted">
									<span className="block h-2 rounded-full" style={{ width: `${(cat.amount / max) * 100}%`, background: `var(--cat-${categoryKey(cat.category)})` }} />
								</span>
								<span className="text-right tabular-nums">
									{money(cat.amount, data.currency)} <span className="inline-block w-12 text-muted-foreground">{percent(cat.share)}</span>
								</span>
							</a>
						</li>
					))}
					{!data.by_category.length && <li className="text-sm text-muted-foreground">No spending in this period.</li>}
				</ul>
			</CardContent>
		</Card>
	);
}

// --- Area Chart - Interactive ----------------------------------------------

function SpendingTrend({ data }: { data: DashboardData }) {
	const [range, setRange] = useState("6");
	const rows = useMemo(() => {
		const list = range === "all" ? data.trend : data.trend.slice(-Number(range));
		return list.map((m) => ({ month: m.month, ...Object.fromEntries(GROUPS.map((g) => [groupKey(g.name), m.groups[g.name]])) }));
	}, [data, range]);
	return (
		<Card className="pt-0">
			<CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
				<div className="grid flex-1 gap-1">
					<CardTitle>Monthly spending</CardTitle>
					<CardDescription>Stacked by category group</CardDescription>
				</div>
				<Select value={range} onValueChange={setRange}>
					<SelectTrigger className="w-[160px] rounded-lg sm:ml-auto" aria-label="Time range">
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="rounded-xl">
						<SelectItem value="3">Last 3 months</SelectItem>
						<SelectItem value="6">Last 6 months</SelectItem>
						<SelectItem value="12">Last 12 months</SelectItem>
						<SelectItem value="all">All time</SelectItem>
					</SelectContent>
				</Select>
			</CardHeader>
			<CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
				<ChartContainer config={groupChartConfig} className="aspect-auto h-[280px] w-full">
					<AreaChart data={rows}>
						<defs>
							{GROUPS.map((g) => (
								<linearGradient key={g.name} id={`fill-${groupKey(g.name)}`} x1="0" y1="0" x2="0" y2="1">
									<stop offset="5%" stopColor={`var(--color-${groupKey(g.name)})`} stopOpacity={0.8} />
									<stop offset="95%" stopColor={`var(--color-${groupKey(g.name)})`} stopOpacity={0.1} />
								</linearGradient>
							))}
						</defs>
						<CartesianGrid vertical={false} />
						<XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(m) => monthLabel(m, "short")} />
						<YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(v, data.currency, { compact: true })} />
						<ChartTooltip
							cursor={false}
							content={<ChartTooltipContent labelFormatter={(m) => monthLabel(String(m))} indicator="dot" formatter={moneyFormatter(data.currency, groupChartConfig)} />}
						/>
						{GROUPS.map((g) => (
							<Area
								key={g.name}
								dataKey={groupKey(g.name)}
								type="monotone"
								fill={`url(#fill-${groupKey(g.name)})`}
								stroke={`var(--color-${groupKey(g.name)})`}
								strokeWidth={2}
								stackId="a"
								isAnimationActive={false}
							/>
						))}
						<ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

function moneyFormatter(currency: string, config: ChartConfig) {
	// Tooltip row: colour, label from config, amount.
	return (value: unknown, name: unknown, item: { color?: string; payload?: { fill?: string } }) => (
		<TooltipRow label={(config[String(name)]?.label as string) ?? String(name)} value={money(Number(value), currency)} color={item.color ?? item.payload?.fill} />
	);
}

// --- Bar Chart - Multiple ---------------------------------------------------

const incomeConfig = {
	income: { label: "Income", theme: { light: "#6250d6", dark: "#9085e9" } },
	spent: { label: "Spending", theme: { light: "#8a8984", dark: "#8f8f97" } },
} satisfies ChartConfig;

function IncomeVsSpending({ data }: { data: DashboardData }) {
	const rows = data.trend.slice(-12);
	return (
		<Card>
			<CardHeader>
				<CardTitle>Income vs spending</CardTitle>
				<CardDescription>Per month, transfers excluded</CardDescription>
			</CardHeader>
			<CardContent>
				<ChartContainer config={incomeConfig} className="aspect-auto h-[260px] w-full">
					<BarChart accessibilityLayer data={rows}>
						<CartesianGrid vertical={false} />
						<XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} tickFormatter={(m) => monthLabel(m, "short")} />
						<YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(v, data.currency, { compact: true })} />
						<ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dashed" labelFormatter={(m) => monthLabel(String(m))} formatter={moneyFormatter(data.currency, incomeConfig)} />} />
						<ChartLegend content={<ChartLegendContent />} />
						<Bar dataKey="income" fill="var(--color-income)" radius={4} isAnimationActive={false} />
						<Bar dataKey="spent" fill="var(--color-spent)" radius={4} isAnimationActive={false} />
					</BarChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

// --- Bar Chart - Negative (horizontal): change vs last month -----------------

const changeConfig = {
	change: { label: "Change" },
	up: { label: "Spent more", theme: CHANGE_COLORS.up },
	down: { label: "Spent less", theme: CHANGE_COLORS.down },
} satisfies ChartConfig;

function CategoryChange({ data }: { data: DashboardData }) {
	const rows = useMemo(() => {
		const before = new Map(data.previous_by_category.map((c) => [c.category, c.amount]));
		const now = new Map(data.by_category.map((c) => [c.category, c.amount]));
		const cats = new Set([...before.keys(), ...now.keys()]);
		return [...cats]
			.map((category) => ({ category, change: Math.round(((now.get(category) ?? 0) - (before.get(category) ?? 0)) * 100) / 100 }))
			.filter((r) => Math.abs(r.change) >= 1)
			.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
			.slice(0, 10);
	}, [data]);
	return (
		<Card>
			<CardHeader>
				<CardTitle>Change vs {monthLabel(data.period === "all" ? "all" : prevMonth(data.period))}</CardTitle>
				<CardDescription>Biggest changes in spending per category</CardDescription>
			</CardHeader>
			<CardContent>
				{rows.length ? (
					<ChartContainer config={changeConfig} className="aspect-auto w-full" style={{ height: Math.max(160, rows.length * 34) }}>
						<BarChart accessibilityLayer data={rows} layout="vertical" margin={{ left: 8, right: 56 }}>
							<CartesianGrid horizontal={false} />
							<XAxis type="number" hide />
							<YAxis dataKey="category" type="category" tickLine={false} axisLine={false} width={120} />
							<ChartTooltip
								cursor={false}
								content={<ChartTooltipContent hideIndicator formatter={(v) => `${Number(v) > 0 ? "+" : ""}${money(Number(v), data.currency)} vs last month`} />}
							/>
							<Bar dataKey="change" radius={4} isAnimationActive={false}>
								<LabelList
									dataKey="change"
									content={(props) => {
										// Right edge of the bar: the bar end for increases, the zero line for
										// decreases (their width is negative), so labels never collide with
										// the bar or the category names.
										const { x, y, width, height, value } = props as { x: number; y: number; width: number; height: number; value: number };
										return (
											<text x={Math.max(x, x + width) + 6} y={y + height / 2} dominantBaseline="middle" className="fill-foreground text-xs">
												{`${value > 0 ? "+" : ""}${money(value, data.currency, { compact: Math.abs(value) >= 1000 })}`}
											</text>
										);
									}}
								/>
								{rows.map((r) => (
									<Cell key={r.category} fill={r.change > 0 ? "var(--color-up)" : "var(--color-down)"} />
								))}
							</Bar>
						</BarChart>
					</ChartContainer>
				) : (
					<p className="text-sm text-muted-foreground">No previous month to compare with.</p>
				)}
			</CardContent>
			<CardFooter className="gap-4 text-xs text-muted-foreground">
				<span className="inline-flex items-center gap-1.5">
					<ArrowUpRight className="size-3.5 text-red-600 dark:text-red-400" /> Spent more
				</span>
				<span className="inline-flex items-center gap-1.5">
					<ArrowDownRight className="size-3.5 text-green-600 dark:text-green-400" /> Spent less
				</span>
			</CardFooter>
		</Card>
	);
}

function prevMonth(m: string) {
	const [y, mo] = m.split("-").map(Number);
	const d = new Date(Date.UTC(y, mo - 2, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// --- Bar Chart - Custom Label (horizontal): top merchants ---------------------

function TopMerchants({ data }: { data: DashboardData }) {
	const rows = data.top_merchants.map((m) => ({ ...m, fill: `var(--color-${categoryKey(m.category)})` }));
	const config = { amount: { label: "Spent" }, ...categoryChartConfig } satisfies ChartConfig;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Top merchants</CardTitle>
				<CardDescription>Click a merchant for its details</CardDescription>
			</CardHeader>
			<CardContent>
				{rows.length ? (
					<ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(160, rows.length * 38) }}>
						<BarChart accessibilityLayer data={rows} layout="vertical" margin={{ right: 72 }}>
							<CartesianGrid horizontal={false} />
							<YAxis dataKey="merchant" type="category" tickLine={false} axisLine={false} width={112} tickFormatter={(m: string) => (m.length > 16 ? `${m.slice(0, 15)}…` : m)} />
							<XAxis dataKey="amount" type="number" hide />
							<ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" formatter={(v, _n, item) => `${money(Number(v), data.currency)} · ${item.payload.count} payments`} />} />
							<Bar dataKey="amount" radius={4} isAnimationActive={false} className="cursor-pointer" onClick={(d: { payload?: { merchant_key?: string } }) => d.payload?.merchant_key && (location.hash = merchantHref(d.payload.merchant_key).slice(1))}>
								<LabelList dataKey="amount" position="right" offset={8} className="fill-foreground text-xs" formatter={(v: unknown) => money(Number(v), data.currency)} />
							</Bar>
						</BarChart>
					</ChartContainer>
				) : (
					<p className="text-sm text-muted-foreground">No spending in this period.</p>
				)}
			</CardContent>
		</Card>
	);
}

function FlaggedCard({ data, link }: { data: DashboardData; link: string }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<AlertTriangle className="size-4 text-amber-600" /> Flagged
				</CardTitle>
				<CardDescription>
					{data.flagged.count ? `${data.flagged.count} unusual ${data.flagged.count === 1 ? "charge" : "charges"} to check` : "Nothing unusual"}
				</CardDescription>
				{data.flagged.count > 0 && (
					<CardAction>
						<Button variant="outline" size="sm" asChild>
							<a href={link}>See all</a>
						</Button>
					</CardAction>
				)}
			</CardHeader>
			<CardContent>
				<ul className="divide-y">
					{data.flagged.items.map((t) => (
						<li key={t.id} className="flex items-start gap-3 py-2.5 text-sm">
							<div className="min-w-0 flex-1">
								<a href={merchantHref(t.merchant_key)} className="font-medium hover:underline">
									{t.merchant}
								</a>
								<span className="text-muted-foreground"> · {formatDate(t.date)}</span>
								{t.flags.map((f) => (
									<p key={f.code} className="text-muted-foreground">
										<span className="font-medium text-foreground">{FLAG_LABELS[f.code]}:</span> {f.reason}
									</p>
								))}
							</div>
							<span className="tabular-nums">{money(t.amount, t.currency)}</span>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
