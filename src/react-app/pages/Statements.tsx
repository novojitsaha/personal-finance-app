import type { ColumnDef } from "@tanstack/react-table";
import { FileUp, Layers, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CategoryBadge } from "@/components/category-badge";
import { DataTable, SortHeader } from "@/components/data-table";
import { deleteStatement, getStatement, listStatements, uploadStatement } from "@/api";
import { formatDate, money } from "@/format";
import { PdfError, preparePdf } from "@/pdf";
import { cn } from "@/lib/utils";
import type { Statement, StatementWithTransactions, Transaction } from "../../shared/api";

const POLL_MS = 2500;

/** "41 already present, 12 new" for statements that overlap earlier ones. */
export function overlapText(s: Statement): string | null {
	if (s.status !== "done" || s.transaction_count === null || s.inserted_count === null) return null;
	const present = s.transaction_count - s.inserted_count;
	if (present <= 0) return null;
	return `Overlaps with an earlier statement: ${present} ${present === 1 ? "transaction" : "transactions"} already present, ${s.inserted_count} new`;
}

export function Statements() {
	const [statements, setStatements] = useState<Statement[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [toDelete, setToDelete] = useState<Statement | null>(null);

	const refresh = useCallback(async () => {
		try {
			setStatements(await listStatements());
		} catch (e) {
			toast.error((e as Error).message);
		}
	}, []);
	useEffect(() => {
		let cancelled = false;
		listStatements().then(
			(l) => !cancelled && setStatements(l),
			(e: Error) => !cancelled && toast.error(e.message),
		);
		return () => {
			cancelled = true;
		};
	}, []);
	const busy = statements?.some((s) => s.status === "uploaded" || s.status === "processing") ?? false;
	useEffect(() => {
		if (!busy) return;
		const t = setInterval(() => void refresh(), POLL_MS);
		return () => clearInterval(t);
	}, [busy, refresh]);

	const columns = useMemo<ColumnDef<Statement, unknown>[]>(
		() => [
			{
				accessorKey: "filename",
				header: ({ column }) => <SortHeader column={column} title="File" />,
				cell: ({ row }) => {
					const s = row.original;
					const overlap = overlapText(s);
					return (
						<div className="max-w-[360px] space-y-1">
							<div className="truncate font-medium">{s.filename}</div>
							{overlap && (
								<p className="flex items-center gap-1 text-xs text-muted-foreground">
									<Layers className="size-3" /> {overlap}
								</p>
							)}
							{s.warning && <p className="text-xs text-amber-700 dark:text-amber-400">⚠ {s.warning}</p>}
							{s.error && <p className="text-xs text-destructive">{s.error}</p>}
						</div>
					);
				},
				enableHiding: false,
			},
			{ accessorKey: "bank", header: "Bank", cell: ({ row }) => row.original.bank ?? "—" },
			{
				id: "period",
				header: "Period",
				accessorFn: (s) => s.period_start ?? "",
				cell: ({ row }) =>
					row.original.period_start ? (
						<span className="whitespace-nowrap">
							{formatDate(row.original.period_start)} – {formatDate(row.original.period_end)}
						</span>
					) : (
						"—"
					),
			},
			{
				accessorKey: "transaction_count",
				header: ({ column }) => <SortHeader column={column} title="Transactions" align="right" />,
				cell: ({ row }) => <div className="text-right tabular-nums">{row.original.status === "done" ? row.original.transaction_count : "—"}</div>,
				meta: { className: "text-right" },
			},
			{
				accessorKey: "status",
				header: "Status",
				cell: ({ row }) => <StatusBadge s={row.original} />,
				enableHiding: false,
			},
			{
				accessorKey: "uploaded_at",
				header: ({ column }) => <SortHeader column={column} title="Uploaded" />,
				cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.uploaded_at.slice(0, 10))}</span>,
			},
			{
				id: "delete",
				header: () => <span className="sr-only">Delete</span>,
				cell: ({ row }) => (
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						aria-label={`Delete ${row.original.filename}`}
						onClick={(e) => {
							e.stopPropagation();
							setToDelete(row.original);
						}}
					>
						<Trash2 />
					</Button>
				),
				enableHiding: false,
			},
		],
		[],
	);

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Statements</h1>
				<p className="text-sm text-muted-foreground">
					Upload bank statement PDFs. Overlapping statements are fine: transactions already imported are recognised and not counted twice.
				</p>
			</div>
			<Upload onUploaded={refresh} />
			<Card>
				<CardHeader>
					<CardTitle>Uploaded statements</CardTitle>
					<CardDescription>Click a finished statement to see its transactions.</CardDescription>
				</CardHeader>
				<CardContent>
					<DataTable
						columns={columns}
						data={statements ?? []}
						initialSorting={[{ id: "uploaded_at", desc: true }]}
						initialHidden={{ uploaded_at: true }}
						onRowClick={(s) => s.status === "done" && setSelected(s.id)}
						empty={statements ? "No statements yet." : "Loading…"}
					/>
				</CardContent>
			</Card>
			<StatementSheet id={selected} onClose={() => setSelected(null)} />
			<Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete {toDelete?.filename}?</DialogTitle>
						<DialogDescription>
							The PDF and the transactions that only appear in this statement are deleted. Transactions that another uploaded statement also
							contains are kept. This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setToDelete(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={async () => {
								if (!toDelete) return;
								try {
									const r = await deleteStatement(toDelete.id);
									toast.success(`Statement deleted, with ${r.deleted_transactions} transactions no other statement contains.`);
									setToDelete(null);
									void refresh();
								} catch (e) {
									toast.error((e as Error).message);
								}
							}}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function StatusBadge({ s }: { s: Statement }) {
	switch (s.status) {
		case "uploaded":
			return <Badge variant="secondary">Queued</Badge>;
		case "processing":
			return (
				<Badge variant="secondary">
					<Loader2 className="animate-spin" /> Processing
				</Badge>
			);
		case "done":
			return (
				<Badge variant="outline" className="border-green-600/40 text-green-700 dark:text-green-400">
					{s.extraction_method === "vision" ? "Done (OCR)" : "Done"}
				</Badge>
			);
		case "failed":
			return <Badge variant="destructive">Failed</Badge>;
	}
}

interface UploadItem {
	key: string;
	name: string;
	state: "reading" | "uploading" | "done" | "error";
	message?: string;
}

function Upload({ onUploaded }: { onUploaded: () => void }) {
	const [items, setItems] = useState<UploadItem[]>([]);
	const [dragging, setDragging] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const update = (key: string, patch: Partial<UploadItem>) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...patch } : i)));

	const handleFiles = async (files: File[]) => {
		const queued = files.map((file) => ({ file, key: crypto.randomUUID() }));
		setItems((l) => [...queued.map(({ file, key }) => ({ key, name: file.name, state: "reading" as const })), ...l]);
		for (const { file, key } of queued) {
			try {
				const prepared = await preparePdf(file);
				update(key, { state: "uploading", message: prepared.pageImages.length ? `Scanned PDF: sending ${prepared.pageImages.length} page image(s) for OCR` : undefined });
				await uploadStatement(file, prepared);
				update(key, { state: "done", message: "Uploaded. Progress is shown in the list below." });
				onUploaded();
			} catch (err) {
				update(key, { state: "error", message: err instanceof PdfError ? `This file ${err.message}.` : (err as Error).message });
			}
		}
	};

	return (
		<Card>
			<CardContent className="space-y-3">
				<div
					role="button"
					tabIndex={0}
					className={cn(
						"flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors hover:border-primary/60 hover:bg-muted/50 focus-visible:border-primary focus-visible:outline-none",
						dragging && "border-primary bg-muted/50",
					)}
					onClick={() => input.current?.click()}
					onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
					onDragOver={(e) => {
						e.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(e) => {
						e.preventDefault();
						setDragging(false);
						void handleFiles([...e.dataTransfer.files]);
					}}
				>
					<FileUp className="size-8 text-muted-foreground" />
					<p className="font-medium">Drop PDF statements here</p>
					<p className="text-sm text-muted-foreground">or click to choose files · PDF only, up to 10 MB each</p>
					<input
						ref={input}
						type="file"
						accept="application/pdf,.pdf"
						multiple
						hidden
						onChange={(e) => {
							void handleFiles([...(e.target.files ?? [])]);
							e.target.value = "";
						}}
					/>
				</div>
				{items.length > 0 && (
					<ul className="space-y-1 text-sm">
						{items.map((i) => (
							<li key={i.key} className="flex gap-3">
								<span className="font-medium break-all">{i.name}</span>
								<span className={i.state === "error" ? "text-destructive" : "text-muted-foreground"}>
									{i.state === "reading" && "Reading PDF…"}
									{i.state === "uploading" && "Uploading…"}
									{i.message && ` ${i.message}`}
								</span>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

const txColumns: ColumnDef<Transaction, unknown>[] = [
	{ accessorKey: "date", header: ({ column }) => <SortHeader column={column} title="Date" />, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.date)}</span> },
	{ accessorKey: "merchant", header: "Merchant", cell: ({ row }) => row.original.merchant ?? "—" },
	{ accessorKey: "category", header: "Category", cell: ({ row }) => <CategoryBadge category={row.original.category} /> },
	{
		accessorKey: "amount",
		header: ({ column }) => <SortHeader column={column} title="Amount" align="right" />,
		cell: ({ row }) => <div className={cn("text-right tabular-nums", row.original.amount > 0 && "text-green-700 dark:text-green-400")}>{money(row.original.amount, row.original.currency)}</div>,
		meta: { className: "text-right" },
	},
];

function StatementSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
	const [data, setData] = useState<StatementWithTransactions | null>(null);
	useEffect(() => {
		if (!id) return;
		let cancelled = false;
		getStatement(id).then(
			(d) => !cancelled && setData(d),
			(e: Error) => toast.error(e.message),
		);
		return () => {
			cancelled = true;
			setData(null);
		};
	}, [id]);
	const c = data?.currency ?? "EUR";
	const totalIn = data?.transactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0) ?? 0;
	const totalOut = data?.transactions.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0) ?? 0;
	return (
		<Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
				<SheetHeader>
					<SheetTitle className="break-all">{data?.filename ?? "Loading…"}</SheetTitle>
					<SheetDescription>
						{data ? `${data.bank ?? "Unknown bank"} · ${data.account_iban_or_name ?? "unknown account"} · ${formatDate(data.period_start)} – ${formatDate(data.period_end)}` : ""}
					</SheetDescription>
				</SheetHeader>
				{data && (
					<div className="space-y-4 px-4 pb-6">
						<dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							{[
								["Opening", data.opening_balance !== null ? money(data.opening_balance, c) : "—"],
								["Money in", money(totalIn, c)],
								["Money out", money(totalOut, c)],
								["Closing", data.closing_balance !== null ? money(data.closing_balance, c) : "—"],
							].map(([k, v]) => (
								<div key={k} className="rounded-lg border p-3">
									<dt className="text-xs text-muted-foreground">{k}</dt>
									<dd className="font-medium tabular-nums">{v}</dd>
								</div>
							))}
						</dl>
						{overlapText(data) && (
							<Alert>
								<Layers />
								<AlertDescription>{overlapText(data)}. All of them are listed here.</AlertDescription>
							</Alert>
						)}
						<DataTable columns={txColumns} data={data.transactions} initialSorting={[{ id: "date", desc: false }]} />
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
