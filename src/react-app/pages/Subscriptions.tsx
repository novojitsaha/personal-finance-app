import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Check, Trash2, X, CalendarClock, CalendarRange, Repeat, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryBadge } from "@/components/category-badge";
import { DataTable, SortHeader } from "@/components/data-table";
import { useChartMotion } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { deleteRecurring, dismissSuggestion, getRecurring, markRecurring } from "@/api";
import { formatDate, money } from "@/format";
import { merchantHref } from "@/router";
import { categoryChartConfig, categoryKey } from "@/theme";
import type { RecurringOverview, RecurringSuggestion, Subscription } from "../../shared/api";

export function Subscriptions() {
	const [data, setData] = useState<RecurringOverview | null>(null);
	const [version, setVersion] = useState(0);
	const reload = useCallback(() => setVersion((v) => v + 1), []);
	const motion = useChartMotion();
	useEffect(() => {
		getRecurring().then(setData, (e: Error) => toast.error(e.message));
	}, [version]);

	const columns = useMemo<ColumnDef<Subscription, unknown>[]>(
		() => [
			{
				accessorKey: "merchant",
				header: ({ column }) => <SortHeader column={column} title="Payment" />,
				cell: ({ row }) => (
					<div className="space-y-1">
						<a href={merchantHref(row.original.merchant_key)} className="font-medium hover:underline">
							{row.original.merchant}
						</a>
						{row.original.warnings.map((w) => (
							<p key={w.code} className="flex items-start gap-1 text-xs text-warning">
								<AlertTriangle className="mt-0.5 size-3 shrink-0" />
								{w.message}
							</p>
						))}
					</div>
				),
				enableHiding: false,
			},
			{ accessorKey: "category", header: "Category", cell: ({ row }) => <CategoryBadge category={row.original.category} /> },
			{ accessorKey: "last_date", header: ({ column }) => <SortHeader column={column} title="Last charge" />, cell: ({ row }) => formatDate(row.original.last_date) },
			{ accessorKey: "charges", header: "Charges" },
			{
				accessorKey: "monthly",
				header: ({ column }) => <SortHeader column={column} title="Per month" align="right" />,
				cell: ({ row }) => <div className="text-right font-medium tabular-nums">{money(row.original.monthly, row.original.currency)}</div>,
				meta: { className: "text-right" },
				enableHiding: false,
			},
			{
				accessorKey: "yearly",
				header: "Per year",
				cell: ({ row }) => <div className="text-right tabular-nums text-muted-foreground">{money(row.original.yearly, row.original.currency)}</div>,
				meta: { className: "text-right" },
			},
			{
				id: "remove",
				header: () => <span className="sr-only">Remove</span>,
				cell: ({ row }) => (
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						aria-label="Not recurring"
						onClick={async () => {
							await deleteRecurring(row.original.id);
							toast(`${row.original.merchant} is no longer marked as recurring.`);
							reload();
						}}
					>
						<Trash2 />
					</Button>
				),
				enableHiding: false,
			},
		],
		[reload],
	);

	if (!data) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-12 w-80" />
				<div className="grid gap-4 sm:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-28" />
					))}
				</div>
				<Skeleton className="h-80" />
			</div>
		);
	}
	const warnings = data.subscriptions.filter((s) => s.warnings.length);
	const chartRows = data.subscriptions.map((s) => ({ name: s.merchant, monthly: s.monthly, fill: `var(--color-${categoryKey(s.category)})` }));
	const config = { monthly: { label: "Per month" }, ...categoryChartConfig } satisfies ChartConfig;

	return (
		<div className="stagger space-y-4 md:space-y-5">
			<PageHeader
				title="Subscriptions & recurring payments"
				description="Monthly payments you confirmed. New statements are matched automatically (same merchant, amount within 10% of the last charge)."
				className="animate-none"
			/>
			<div className="grid gap-4 sm:grid-cols-3 md:gap-5">
				<StatCard index={0} label="Per month" icon={CalendarClock} value={data.monthly_total} format={(n) => money(n, data.currency)} />
				<StatCard index={1} label="Per year" icon={CalendarRange} tone="warning" value={data.yearly_total} format={(n) => money(n, data.currency)} />
				<StatCard index={2} label="Recurring payments" icon={Repeat} tone="positive" value={data.subscriptions.length} format={(n) => String(Math.round(n))} />
			</div>

			{warnings.length > 0 && (
				<Alert className="border-[color-mix(in_oklch,var(--warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] [&>svg]:text-warning">
					<AlertTriangle />
					<AlertTitle>{warnings.length === 1 ? "1 payment needs a look" : `${warnings.length} payments need a look`}</AlertTitle>
					<AlertDescription>
						{warnings.map((s) => (
							<p key={s.id}>
								<span className="font-medium text-foreground">{s.merchant}:</span> {s.warnings.map((w) => w.message).join(" ")}
							</p>
						))}
					</AlertDescription>
				</Alert>
			)}

			{data.suggestions.length > 0 && <Suggestions items={data.suggestions} onChanged={reload} />}

			<DataTable columns={columns} data={data.subscriptions} initialSorting={[{ id: "monthly", desc: true }]} empty="No recurring payments yet. Confirm a suggestion or mark a transaction as recurring." />

			{chartRows.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>Monthly cost per payment</CardTitle>
					</CardHeader>
					<CardContent>
						<ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(140, chartRows.length * 36) }}>
							<BarChart accessibilityLayer data={chartRows} layout="vertical" margin={{ right: 72 }}>
								<YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={112} tickFormatter={(m: string) => (m.length > 16 ? `${m.slice(0, 15)}…` : m)} />
								<XAxis dataKey="monthly" type="number" hide />
								<ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator formatter={(v) => money(Number(v), data.currency)} />} />
								<Bar dataKey="monthly" radius={6} {...motion}>
									<LabelList dataKey="monthly" position="right" offset={8} className="fill-foreground text-xs" formatter={(v: unknown) => money(Number(v), data.currency)} />
								</Bar>
							</BarChart>
						</ChartContainer>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

function Suggestions({ items, onChanged }: { items: RecurringSuggestion[]; onChanged: () => void }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Sparkles className="size-4" />
					</span>
					Looks recurring
				</CardTitle>
				<CardDescription>Charged a similar amount in 3 or more months. Nothing is marked until you confirm.</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="divide-y">
					{items.map((s) => (
						<li key={s.merchant_key} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
							<div className="min-w-0 flex-1">
								<a href={merchantHref(s.merchant_key)} className="font-medium hover:underline">
									{s.merchant}
								</a>
								<p className="text-muted-foreground">
									About {money(s.amount, s.currency)} in {s.months} months · last on {formatDate(s.last_date)}
								</p>
							</div>
							<Button
								size="sm"
								onClick={async () => {
									await markRecurring({ merchant_key: s.merchant_key, amount: s.amount });
									toast.success(`${s.merchant} marked as recurring.`);
									onChanged();
								}}
							>
								<Check /> Recurring
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={async () => {
									await dismissSuggestion(s.merchant_key);
									onChanged();
								}}
							>
								<X /> Not recurring
							</Button>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
