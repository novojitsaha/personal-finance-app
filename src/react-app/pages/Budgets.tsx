// Budgets: a monthly budget per category (and optionally overall), looked back
// on per completed month. The radial chart is adapted from the shadcn chart
// gallery's "Radial Chart - Text".
import type { ColumnDef } from "@tanstack/react-table";
import { CircleCheck, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Label, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryDot } from "@/components/category-badge";
import { DataTable, SortHeader } from "@/components/data-table";
import { getBudgets, getDashboard, setBudget } from "@/api";
import { money, monthLabel } from "@/format";
import { href } from "@/router";
import { PeriodSelect } from "./Dashboard";
import { CATEGORIES, isSpendingCategory } from "../../shared/categories";
import type { BudgetOverview, Dashboard } from "../../shared/api";

interface Row {
	category: string;
	spent: number;
	budget: number | null;
}

export function Budgets({ params }: { params: URLSearchParams }) {
	const [overview, setOverview] = useState<BudgetOverview | null>(null);
	const [month, setMonth] = useState<Dashboard | null>(null);
	const [version, setVersion] = useState(0);
	const reload = useCallback(() => setVersion((v) => v + 1), []);
	const selected = params.get("month");

	useEffect(() => {
		getBudgets().then(setOverview, (e: Error) => toast.error(e.message));
	}, [version]);
	useEffect(() => {
		getDashboard(selected).then(setMonth, (e: Error) => toast.error(e.message));
	}, [selected, version]);

	const rows = useMemo<Row[]>(() => {
		if (!overview || !month) return [];
		const spent = new Map(month.by_category.map((c) => [c.category as string, c.amount]));
		return CATEGORIES.filter(isSpendingCategory).map((c) => ({ category: c, spent: spent.get(c) ?? 0, budget: overview.budgets[c] ?? null }));
	}, [overview, month]);

	const save = useCallback(
		async (category: string, value: string) => {
			const amount = value.trim() === "" ? null : Number(value.replace(",", "."));
			if (amount !== null && !(amount > 0)) return toast.error("Enter a positive amount, or leave it empty for no budget.");
			try {
				await setBudget(category, amount);
				toast.success(amount === null ? `Budget for ${category === "*" ? "the month" : category} removed.` : `Budget saved.`);
				reload();
			} catch (e) {
				toast.error((e as Error).message);
			}
		},
		[reload],
	);

	const currency = overview?.currency ?? "EUR";
	const columns = useMemo<ColumnDef<Row, unknown>[]>(
		() => [
			{
				accessorKey: "category",
				header: ({ column }) => <SortHeader column={column} title="Category" />,
				cell: ({ row }) => (
					<a href={href("/transactions", { category: row.original.category, month: month?.period === "all" ? null : month?.period })} className="flex items-center gap-2 hover:underline">
						<CategoryDot category={row.original.category} />
						{row.original.category}
					</a>
				),
				enableHiding: false,
			},
			{
				accessorKey: "spent",
				header: ({ column }) => <SortHeader column={column} title="Spent" align="right" />,
				cell: ({ row }) => <div className="text-right tabular-nums">{money(row.original.spent, currency)}</div>,
				meta: { className: "text-right" },
				enableHiding: false,
			},
			{
				accessorKey: "budget",
				header: "Monthly budget",
				cell: ({ row }) => <BudgetInput value={row.original.budget} onSave={(v) => save(row.original.category, v)} />,
				enableHiding: false,
			},
			{
				id: "used",
				header: "Used",
				accessorFn: (r) => (r.budget ? r.spent / r.budget : -1),
				cell: ({ row }) => <Usage spent={row.original.spent} budget={row.original.budget} currency={currency} />,
				enableHiding: false,
			},
		],
		[currency, month, save],
	);

	if (!overview || !month) return <Skeleton className="h-96" />;
	const total = overview.budgets["*"] ?? null;
	const budgeted = rows.filter((r) => r.budget !== null);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<div className="mr-auto">
					<h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
					<p className="text-sm text-muted-foreground">Set a monthly budget per category and see how each completed month went.</p>
				</div>
				<PeriodSelect months={month.months} value={month.period} onChange={(v) => (location.hash = href("/budgets", { month: v }).slice(1))} />
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<OverallRadial spent={month.kpis.spent} budget={total} currency={currency} period={month.period} onSave={(v) => save("*", v)} />
				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>Month by month</CardTitle>
						<CardDescription>Spending against the overall budget and category budgets</CardDescription>
					</CardHeader>
					<CardContent>
						<ul className="divide-y">
							{overview.months.map((m) => {
								const over = m.categories.filter((c) => c.over);
								return (
									<li key={m.month} className="flex flex-wrap items-center gap-3 py-2 text-sm">
										<a href={href("/budgets", { month: m.month })} className="w-36 font-medium hover:underline">
											{monthLabel(m.month)}
										</a>
										<span className="tabular-nums">{money(m.total.spent, currency)}</span>
										{m.total.budget !== null && <StatusBadge over={!!m.total.over} diff={m.total.diff ?? 0} currency={currency} />}
										<span className="ml-auto text-muted-foreground">
											{m.categories.length ? (over.length ? `${over.length} of ${m.categories.length} categories over` : "All categories within budget") : "No category budgets"}
										</span>
									</li>
								);
							})}
						</ul>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{monthLabel(month.period)} per category</CardTitle>
					<CardDescription>
						{budgeted.length
							? `${budgeted.filter((r) => r.budget !== null && r.spent > r.budget).length} of ${budgeted.length} budgeted categories over`
							: "No category budgets yet: type an amount to add one."}
						{month.period === "all" && " · For “All time”, budgets are compared with the total over all months."}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<DataTable columns={columns} data={rows} initialSorting={[{ id: "spent", desc: true }]} pageSize={20} />
				</CardContent>
			</Card>
		</div>
	);
}

function BudgetInput({ value, onSave }: { value: number | null; onSave: (v: string) => void }) {
	const [text, setText] = useState(value === null ? "" : String(value));
	return (
		<Input
			inputMode="decimal"
			placeholder="No budget"
			className="h-8 w-28"
			value={text}
			onChange={(e) => setText(e.target.value)}
			onBlur={() => text !== (value === null ? "" : String(value)) && onSave(text)}
			onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
		/>
	);
}

function StatusBadge({ over, diff, currency }: { over: boolean; diff: number; currency: string }) {
	return over ? (
		<Badge variant="outline" className="border-red-500/40 text-red-700 dark:text-red-400">
			<CircleAlert /> Over by {money(-diff, currency)}
		</Badge>
	) : (
		<Badge variant="outline" className="border-green-600/40 text-green-700 dark:text-green-400">
			<CircleCheck /> {money(diff, currency)} left
		</Badge>
	);
}

function Usage({ spent, budget, currency }: { spent: number; budget: number | null; currency: string }) {
	if (budget === null) return <span className="text-xs text-muted-foreground">—</span>;
	const used = spent / budget;
	return (
		<div className="flex min-w-[220px] items-center gap-3">
			<Progress value={Math.min(100, used * 100)} className={used > 1 ? "[&>*]:bg-red-600" : used > 0.9 ? "[&>*]:bg-amber-500" : "[&>*]:bg-green-600"} />
			<StatusBadge over={spent > budget} diff={budget - spent} currency={currency} />
		</div>
	);
}

function OverallRadial({ spent, budget, currency, period, onSave }: { spent: number; budget: number | null; currency: string; period: string; onSave: (v: string) => void }) {
	const used = budget ? spent / budget : 0;
	const over = budget !== null && spent > budget;
	const config = {
		used: { label: "Used", theme: over ? { light: "#d03b3b", dark: "#e66767" } : { light: "#0ca30c", dark: "#2fb52f" } },
	} satisfies ChartConfig;
	const data = [{ name: "used", used: Math.min(used, 1) * 100, fill: "var(--color-used)" }];
	return (
		<Card className="flex flex-col">
			<CardHeader className="items-center pb-0">
				<CardTitle>Overall</CardTitle>
				<CardDescription>{monthLabel(period)}</CardDescription>
			</CardHeader>
			<CardContent className="flex-1 pb-0">
				{budget ? (
					<ChartContainer config={config} className="mx-auto aspect-square max-h-[220px]">
						<RadialBarChart data={data} startAngle={90} endAngle={90 - 360 * Math.min(used, 1)} innerRadius={80} outerRadius={110}>
							<PolarGrid gridType="circle" radialLines={false} stroke="none" className="first:fill-muted last:fill-background" polarRadius={[86, 74]} />
							<RadialBar dataKey="used" background cornerRadius={10} isAnimationActive={false} />
							<PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
								<Label
									content={({ viewBox }) =>
										viewBox && "cx" in viewBox && "cy" in viewBox ? (
											<text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
												<tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
													{Math.round(used * 100)}%
												</tspan>
												<tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 24} className="fill-muted-foreground text-xs">
													of {money(budget, currency)}
												</tspan>
											</text>
										) : null
									}
								/>
							</PolarRadiusAxis>
						</RadialBarChart>
					</ChartContainer>
				) : (
					<p className="py-10 text-center text-sm text-muted-foreground">No overall budget yet.</p>
				)}
			</CardContent>
			<CardFooter className="flex-col gap-2 text-sm">
				<div className="flex items-center gap-2">
					Spent <span className="font-medium tabular-nums">{money(spent, currency)}</span>
					{budget !== null && <StatusBadge over={over} diff={budget - spent} currency={currency} />}
				</div>
				<div className="flex items-center gap-2 text-muted-foreground">
					Monthly budget <BudgetInput value={budget} onSave={onSave} />
				</div>
			</CardFooter>
		</Card>
	);
}
