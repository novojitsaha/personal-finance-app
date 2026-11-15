// shadcn Data Table pattern (TanStack Table v8): sorting, pagination and
// column visibility. https://ui.shadcn.com/docs/components/data-table
import {
	type ColumnDef,
	type SortingState,
	type VisibilityState,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Settings2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function SortHeader({ column, title, align }: { column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (desc?: boolean) => void }; title: string; align?: "right" }) {
	const sorted = column.getIsSorted();
	const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
	return (
		<Button
			variant="ghost"
			size="sm"
			className={cn("-mx-2 h-8 px-2", align === "right" && "ml-auto flex")}
			onClick={() => column.toggleSorting(sorted === "asc")}
		>
			{title}
			<Icon className="size-3.5 text-muted-foreground" />
		</Button>
	);
}

export function DataTable<T>({
	columns,
	data,
	pageSize = 25,
	initialSorting = [],
	initialHidden = {},
	onRowClick,
	empty = "Nothing here yet.",
	toolbar,
	getRowClassName,
}: {
	columns: ColumnDef<T, unknown>[];
	data: T[];
	pageSize?: number;
	initialSorting?: SortingState;
	/** Columns hidden at first (true = hidden); users can show them again. */
	initialHidden?: Record<string, boolean>;
	onRowClick?: (row: T) => void;
	empty?: string;
	toolbar?: React.ReactNode;
	getRowClassName?: (row: T) => string | undefined;
}) {
	const [sorting, setSorting] = useState<SortingState>(initialSorting);
	// initialHidden lists columns to hide (true = hidden); TanStack's visibility
	// state is the opposite (false = hidden).
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
		Object.fromEntries(Object.entries(initialHidden).map(([id, hidden]) => [id, !hidden])),
	);
	// eslint-disable-next-line react-hooks/incompatible-library
	const table = useReactTable({
		data,
		columns,
		state: { sorting, columnVisibility },
		onSortingChange: setSorting,
		onColumnVisibilityChange: setColumnVisibility,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		initialState: { pagination: { pageSize } },
	});
	const hideable = table.getAllColumns().filter((c) => c.getCanHide() && typeof c.columnDef.header === "string");

	return (
		<div className="space-y-3">
			{(toolbar || hideable.length > 0) && (
				<div className="flex flex-wrap items-center gap-2">
					{toolbar}
					{hideable.length > 0 && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="sm" className="ml-auto">
									<Settings2 /> Columns
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuLabel>Show columns</DropdownMenuLabel>
								<DropdownMenuSeparator />
								{hideable.map((column) => (
									<DropdownMenuCheckboxItem
										key={column.id}
										checked={column.getIsVisible()}
										onCheckedChange={(v) => column.toggleVisibility(!!v)}
									>
										{column.columnDef.header as string}
									</DropdownMenuCheckboxItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			)}
			<div className="overflow-hidden rounded-lg border">
				<Table>
					<TableHeader className="bg-muted/50">
						{table.getHeaderGroups().map((hg) => (
							<TableRow key={hg.id}>
								{hg.headers.map((h) => (
									<TableHead key={h.id} className={(h.column.columnDef.meta as { className?: string } | undefined)?.className}>
										{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									className={cn(onRowClick && "cursor-pointer", getRowClassName?.(row.original))}
									onClick={onRowClick ? () => onRowClick(row.original) : undefined}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id} className={(cell.column.columnDef.meta as { className?: string } | undefined)?.className}>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
									{empty}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			{table.getPageCount() > 1 && (
				<div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
					<span>
						{data.length} rows · page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
					</span>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
							Previous
						</Button>
						<Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
							Next
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
