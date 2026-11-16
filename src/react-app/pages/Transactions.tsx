import type { ColumnDef } from "@tanstack/react-table";
import { Repeat, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CategoryDot } from "@/components/category-badge";
import { CategorySelect } from "@/components/category-select";
import { DataTable, SortHeader } from "@/components/data-table";
import { FlagBadges } from "@/components/flag-badges";
import { MerchantFilter } from "@/components/merchant-filter";
import { getDashboard, listTransactions, markRecurring } from "@/api";
import { formatDate, money, monthLabel } from "@/format";
import { merchantHref, navigate } from "@/router";
import { CATEGORIES } from "../../shared/categories";
import type { TransactionRow } from "../../shared/api";

export function transactionColumns(reload: () => void, opts: { merchant?: boolean } = {}): ColumnDef<TransactionRow, unknown>[] {
	const cols: ColumnDef<TransactionRow, unknown>[] = [
		{
			accessorKey: "date",
			header: ({ column }) => <SortHeader column={column} title="Date" />,
			cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.date)}</span>,
			enableHiding: false,
		},
	];
	if (opts.merchant !== false) {
		cols.push({
			accessorKey: "merchant",
			header: ({ column }) => <SortHeader column={column} title="Merchant" />,
			cell: ({ row }) => (
				<div className="flex items-center gap-1.5">
					<a href={merchantHref(row.original.merchant_key)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
						{row.original.merchant}
					</a>
					{row.original.recurring_rule_id !== null && (
						<Tooltip>
							<TooltipTrigger>
								<Repeat className="size-3.5 text-muted-foreground" aria-label="Recurring" />
							</TooltipTrigger>
							<TooltipContent>Monthly recurring payment</TooltipContent>
						</Tooltip>
					)}
				</div>
			),
			enableHiding: false,
		});
	}
	cols.push(
		{
			id: "description",
			accessorKey: "description",
			header: "Description",
			cell: ({ row }) => <span className="block max-w-[320px] truncate text-muted-foreground" title={row.original.description}>{row.original.description}</span>,
		},
		{
			accessorKey: "category",
			header: "Category",
			cell: ({ row }) => (
				<CategorySelect transactionId={row.original.id} merchant={row.original.merchant} category={row.original.category} onChanged={reload} />
			),
		},
		{
			id: "flags",
			header: "Flags",
			accessorFn: (r) => r.flags.length,
			cell: ({ row }) => <FlagBadges transactionId={row.original.id} flags={row.original.flags} onChanged={reload} />,
		},
		{
			accessorKey: "amount",
			header: ({ column }) => <SortHeader column={column} title="Amount" align="right" />,
			cell: ({ row }) => (
				<div className={`text-right font-medium whitespace-nowrap tabular-nums ${row.original.amount > 0 ? "text-green-700 dark:text-green-400" : ""}`}>
					{money(row.original.amount, row.original.currency)}
				</div>
			),
			meta: { className: "text-right" },
			enableHiding: false,
		},
		{
			id: "actions",
			header: () => <span className="sr-only">Actions</span>,
			cell: ({ row }) =>
				row.original.amount < 0 && row.original.recurring_rule_id === null ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7"
								aria-label="Mark as monthly recurring"
								onClick={async (e) => {
									e.stopPropagation();
									try {
										await markRecurring({ transaction_id: row.original.id });
										toast.success(`${row.original.merchant} marked as a monthly recurring payment.`);
										reload();
									} catch (err) {
										toast.error((err as Error).message);
									}
								}}
							>
								<Repeat />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Mark as monthly recurring</TooltipContent>
					</Tooltip>
				) : null,
			enableHiding: false,
		},
	);
	return cols;
}

export function Transactions({ params }: { params: URLSearchParams }) {
	const filters = useMemo(
		() => ({
			q: params.get("q") ?? "",
			month: params.get("month") ?? "",
			category: params.get("category") ?? "",
			merchant: params.get("merchant") ?? "",
			recurring: params.get("recurring") ?? "",
			flagged: params.get("flagged") ?? "",
		}),
		[params],
	);
	const [items, setItems] = useState<{ rows: TransactionRow[]; total: number } | null>(null);
	const [months, setMonths] = useState<string[]>([]);
	const [search, setSearch] = useState(filters.q);
	const [version, setVersion] = useState(0);
	const reload = useCallback(() => setVersion((v) => v + 1), []);

	const update = (patch: Partial<typeof filters>) => navigate("/transactions", { ...filters, ...patch }, true);

	useEffect(() => {
		getDashboard("all").then((d) => setMonths(d.months), () => setMonths([]));
	}, []);
	useEffect(() => {
		let cancelled = false;
		listTransactions({ ...filters, limit: "1000" }).then(
			(r) => !cancelled && setItems({ rows: r.items, total: r.total }),
			(e: Error) => !cancelled && toast.error(e.message),
		);
		return () => {
			cancelled = true;
		};
	}, [filters, version]);
	// Debounced search box -> URL
	useEffect(() => {
		if (search === filters.q) return;
		const t = setTimeout(() => update({ q: search }), 300);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [search]);

	const columns = useMemo(() => transactionColumns(reload), [reload]);
	const active = Object.entries(filters).some(([, v]) => v);
	const totals = useMemo(() => {
		const rows = items?.rows ?? [];
		return { out: rows.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0), in: rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0) };
	}, [items]);

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
				<p className="text-sm text-muted-foreground">All transactions across your statements. Filters are kept in the address bar, so you can bookmark a view.</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
					<CardDescription>
						{items ? `${items.total} transactions · ${money(totals.out)} out · ${money(totals.in)} in` : "Loading…"}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap items-center gap-2">
					<Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-[200px]" />
					<Select value={filters.month || "all"} onValueChange={(v) => update({ month: v === "all" ? "" : v })}>
						<SelectTrigger size="sm" className="w-[150px]" aria-label="Month">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All months</SelectItem>
							{[...months].reverse().map((m) => (
								<SelectItem key={m} value={m}>
									{monthLabel(m)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={filters.category || "all"} onValueChange={(v) => update({ category: v === "all" ? "" : v })}>
						<SelectTrigger size="sm" className="w-[180px]" aria-label="Category">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All categories</SelectItem>
							{CATEGORIES.map((c) => (
								<SelectItem key={c} value={c}>
									<CategoryDot category={c} /> {c}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<MerchantFilter value={filters.merchant ? filters.merchant.split(",") : []} onChange={(keys) => update({ merchant: keys.join(",") })} />
					<div className="flex items-center gap-2 px-1">
						<Checkbox id="recurring" checked={filters.recurring === "1"} onCheckedChange={(v) => update({ recurring: v ? "1" : "" })} />
						<Label htmlFor="recurring">Recurring</Label>
					</div>
					<div className="flex items-center gap-2 px-1">
						<Checkbox id="flagged" checked={filters.flagged === "1"} onCheckedChange={(v) => update({ flagged: v ? "1" : "" })} />
						<Label htmlFor="flagged">Flagged</Label>
					</div>
					{active && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setSearch("");
								navigate("/transactions", {}, true);
							}}
						>
							<X /> Clear
						</Button>
					)}
				</CardContent>
			</Card>
			<DataTable
				columns={columns}
				data={items?.rows ?? []}
				initialSorting={[{ id: "date", desc: true }]}
				initialHidden={{ description: window.innerWidth < 768 }}
				pageSize={50}
				empty={items ? "No transactions match these filters." : "Loading…"}
			/>
		</div>
	);
}
