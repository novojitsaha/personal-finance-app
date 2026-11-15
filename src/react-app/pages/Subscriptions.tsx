import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Check, Trash2, X } from "lucide-react";
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
import { deleteRecurring, dismissSuggestion, getRecurring, markRecurring } from "@/api";
import { formatDate, money } from "@/format";
import { merchantHref } from "@/router";
import { categoryChartConfig, categoryKey } from "@/theme";
import type { RecurringOverview, RecurringSuggestion, Subscription } from "../../shared/api";

export function Subscriptions() {
	const [data, setData] = useState<RecurringOverview | null>(null);
	const [version, setVersion] = useState(0);
	const reload = useCallback(() => setVersion((v) => v + 1), []);
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
							<p key={w.code} className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
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

	if (!data) return <Skeleton className="h-96" />;
	const warnings = data.subscriptions.filter((s) => s.warnings.length);
	const chartRows = data.subscriptions.map((s) => ({ name: s.merchant, monthly: s.monthly, fill: `var(--color-${categoryKey(s.category)})` }));
	const config = { monthly: { label: "Per month" }, ...categoryChartConfig } satisfies ChartConfig;

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Subscriptions & recurring payments</h1>
				<p className="text-sm text-muted-foreground">
					Monthly payments you confirmed. New statements are matched automatically (same merchant, amount within 10% of the last charge).
				</p>
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				<Card>
					<CardHeader>
						<CardDescription>Per month</CardDescription>
						<CardTitle className="text-2xl tabular-nums">{money(data.monthly_total, data.currency)}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Per year</CardDescription>
						<CardTitle className="text-2xl tabular-nums">{money(data.yearly_total, data.currency)}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Recurring payments</CardDescription>
						<CardTitle className="text-2xl tabular-nums">{data.subscriptions.length}</CardTitle>
					</CardHeader>
				</Card>
			</div>

			{warnings.length > 0 && (
				<Alert>
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
								<Bar dataKey="monthly" radius={4} isAnimationActive={false}>
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
				<CardTitle>Looks recurring</CardTitle>
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
