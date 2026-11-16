import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, GitMerge, Pencil, Repeat, Scissors } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryBadge } from "@/components/category-badge";
import { DataTable, SortHeader } from "@/components/data-table";
import { MerchantFilter } from "@/components/merchant-filter";
import { getMerchant, markRecurring, mergeMerchant, renameMerchant, splitVariant } from "@/api";
import { formatDate, money, monthLabel } from "@/format";
import { href, merchantHref } from "@/router";
import { CATEGORY_COLORS } from "@/theme";
import { transactionColumns } from "./Transactions";
import type { MerchantDetail, MerchantVariant } from "../../shared/api";

export function Merchant({ merchantKey, tab }: { merchantKey: string; tab?: string | null }) {
	const [data, setData] = useState<MerchantDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [version, setVersion] = useState(0);
	const reload = useCallback(() => setVersion((v) => v + 1), []);
	const [dialog, setDialog] = useState<null | { kind: "rename" } | { kind: "merge" } | { kind: "split"; variant: MerchantVariant }>(null);

	useEffect(() => {
		let cancelled = false;
		getMerchant(merchantKey).then(
			(d) => !cancelled && (setData(d), setError(null)),
			(e: Error) => !cancelled && setError(e.message),
		);
		return () => {
			cancelled = true;
		};
	}, [merchantKey, version]);

	const txColumns = useMemo(() => transactionColumns(reload, { merchant: false }), [reload]);
	const variantColumns = useMemo<ColumnDef<MerchantVariant, unknown>[]>(
		() => [
			{
				accessorKey: "example",
				header: "Name on statement",
				cell: ({ row }) => (
					<div>
						<div className="font-mono text-xs">{row.original.example}</div>
						{row.original.raw_merchant && <div className="text-xs text-muted-foreground">read as “{row.original.raw_merchant}”</div>}
					</div>
				),
				enableHiding: false,
			},
			{ accessorKey: "count", header: ({ column }) => <SortHeader column={column} title="Transactions" />, enableHiding: false },
			{
				accessorKey: "total",
				header: ({ column }) => <SortHeader column={column} title="Total" align="right" />,
				cell: ({ row }) => <div className="text-right tabular-nums">{money(row.original.total, data?.currency)}</div>,
				meta: { className: "text-right" },
				enableHiding: false,
			},
			{
				id: "split",
				header: () => <span className="sr-only">Actions</span>,
				cell: ({ row }) =>
					(data?.variants.length ?? 0) > 1 ? (
						<Button variant="outline" size="sm" onClick={() => setDialog({ kind: "split", variant: row.original })}>
							<Scissors /> Split off
						</Button>
					) : null,
				enableHiding: false,
			},
		],
		[data],
	);

	if (error) return <p className="text-destructive">{error}</p>;
	if (!data) return <Skeleton className="h-96" />;

	const chartConfig = { spent: { label: "Spent", theme: CATEGORY_COLORS[data.category] } } satisfies ChartConfig;

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<Button variant="ghost" size="icon" asChild>
					<a href={href("/transactions")} aria-label="Back to transactions">
						<ArrowLeft />
					</a>
				</Button>
				<div className="mr-auto">
					<h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
						{data.merchant}
						{data.recurring_rule_id !== null && (
							<Badge variant="secondary">
								<Repeat /> Recurring
							</Badge>
						)}
					</h1>
					<div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
						<CategoryBadge category={data.category} user={data.override !== null} />
						{data.override && <span>always {data.override} for this merchant</span>}
					</div>
				</div>
				<Button variant="outline" size="sm" onClick={() => setDialog({ kind: "rename" })}>
					<Pencil /> Rename
				</Button>
				<Button variant="outline" size="sm" onClick={() => setDialog({ kind: "merge" })}>
					<GitMerge /> Merge into…
				</Button>
				{data.recurring_rule_id === null && data.spent > 0 && (
					<Button
						variant="outline"
						size="sm"
						onClick={async () => {
							const last = data.transactions.find((t) => t.amount < 0);
							if (!last) return;
							await markRecurring({ transaction_id: last.id });
							toast.success(`${data.merchant} marked as a monthly recurring payment.`);
							reload();
						}}
					>
						<Repeat /> Mark recurring
					</Button>
				)}
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Stat label="Total spent" value={money(data.spent, data.currency)} note={data.received ? `${money(data.received, data.currency)} received` : undefined} />
				<Stat label="Transactions" value={String(data.count)} />
				<Stat label="Average payment" value={money(data.average, data.currency)} />
				<Stat label="First – last" value={`${formatDate(data.first_date)}`} note={`to ${formatDate(data.last_date)}`} />
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Spent per month</CardTitle>
				</CardHeader>
				<CardContent>
					<ChartContainer config={chartConfig} className="aspect-auto h-[200px] w-full">
						<BarChart accessibilityLayer data={data.by_month}>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(m) => monthLabel(m, "short")} />
							<ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(m) => monthLabel(String(m))} formatter={(v) => money(Number(v), data.currency)} />} />
							<Bar dataKey="spent" fill="var(--color-spent)" radius={4} isAnimationActive={false} />
						</BarChart>
					</ChartContainer>
				</CardContent>
			</Card>

			<Tabs defaultValue={tab === "variants" ? "variants" : "transactions"}>
				<TabsList>
					<TabsTrigger value="transactions">Transactions ({data.count})</TabsTrigger>
					<TabsTrigger value="variants">Name variants ({data.variants.length})</TabsTrigger>
				</TabsList>
				<TabsContent value="transactions">
					<DataTable columns={txColumns} data={data.transactions} initialSorting={[{ id: "date", desc: true }]} initialHidden={{ flags: true }} />
				</TabsContent>
				<TabsContent value="variants" className="space-y-2">
					<p className="text-sm text-muted-foreground">
						Different names on your statements that are grouped under {data.merchant}. Split one off to make it its own merchant; the choice is
						remembered for future uploads.
					</p>
					<DataTable columns={variantColumns} data={data.variants} initialSorting={[{ id: "count", desc: true }]} />
				</TabsContent>
			</Tabs>

			<RenameDialog open={dialog?.kind === "rename"} current={data.merchant} onClose={() => setDialog(null)} onSave={async (name) => {
				const r = await renameMerchant(data.merchant_key, name);
				toast.success(`Renamed to ${name}.`);
				setDialog(null);
				location.hash = merchantHref(r.merchant_key).slice(1);
			}} />
			<MergeDialog open={dialog?.kind === "merge"} merchant={data} onClose={() => setDialog(null)} onMerge={async (into) => {
				const r = await mergeMerchant(data.merchant_key, into);
				toast.success(`${data.merchant} merged into ${r.merchant}. Future uploads too.`);
				setDialog(null);
				location.hash = merchantHref(r.merchant_key).slice(1);
			}} />
			{dialog?.kind === "split" && (
				<RenameDialog
					open
					title="Split off this name"
					description={`Transactions named “${dialog.variant.example}” become their own merchant.`}
					current={titleCase(dialog.variant.variant_key)}
					onClose={() => setDialog(null)}
					onSave={async (name) => {
						await splitVariant(data.merchant_key, dialog.variant.variant_key, name);
						toast.success(`Split off as ${name}. Future uploads too.`);
						setDialog(null);
						reload();
					}}
				/>
			)}
		</div>
	);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
	return (
		<Card className="gap-1 py-4">
			<CardHeader className="px-4">
				<CardDescription>{label}</CardDescription>
				<CardTitle className="text-xl tabular-nums">{value}</CardTitle>
				{note && <p className="text-xs text-muted-foreground">{note}</p>}
			</CardHeader>
		</Card>
	);
}

function RenameDialog({
	open,
	current,
	onClose,
	onSave,
	title = "Rename merchant",
	description = "The new name is used everywhere, including future uploads.",
}: {
	open: boolean;
	current: string;
	onClose: () => void;
	onSave: (name: string) => Promise<void>;
	title?: string;
	description?: string;
}) {
	const [name, setName] = useState(current);
	const [busy, setBusy] = useState(false);
	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={async (e) => {
						e.preventDefault();
						setBusy(true);
						try {
							await onSave(name.trim());
						} catch (err) {
							toast.error((err as Error).message);
						} finally {
							setBusy(false);
						}
					}}
					className="space-y-4"
				>
					<Input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Merchant name" />
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={busy || !name.trim()}>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function MergeDialog({ open, merchant, onClose, onMerge }: { open: boolean; merchant: MerchantDetail; onClose: () => void; onMerge: (into: string) => Promise<void> }) {
	const [target, setTarget] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Merge {merchant.merchant} into another merchant</DialogTitle>
					<DialogDescription>Its transactions are then shown under the other merchant, now and for future uploads. You can split them off again later.</DialogDescription>
				</DialogHeader>
				<MerchantFilter value={target} onChange={setTarget} multiple={false} placeholder="Choose merchant" exclude={merchant.merchant_key} />
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!target.length || busy}
						onClick={async () => {
							setBusy(true);
							try {
								await onMerge(target[0]);
							} catch (err) {
								toast.error((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						Merge
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
