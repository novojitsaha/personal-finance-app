// Generative UI for the chat (AI SDK UI pattern): each finance tool call the
// assistant makes is a typed message part, rendered as a small card that
// shows its result at a glance (bars, deltas, transaction rows) instead of a
// JSON dump. Unknown tools or result shapes fall back to the raw view.
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, ChevronRight, Loader2, ReceiptText, Store, Target, Wallet, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { CategoryDot } from "@/components/category-badge";
import { formatDate, money, monthLabel, percent } from "@/format";
import { cn } from "@/lib/utils";

export type AnyToolPart = ToolUIPart | DynamicToolUIPart;

const TOOL_LABELS: Record<string, string> = {
	get_overview: "Overview",
	search_transactions: "Searched transactions",
	spending_by_category: "Spending by category",
	compare_periods: "Compared months",
	merchant_detail: "Merchant details",
	subscriptions: "Subscriptions",
	budget_status: "Budgets",
	unusual_charges: "Unusual charges",
	get_digest: "Monthly summary",
};

const TOOL_ICONS: Record<string, typeof Wrench> = {
	get_overview: Wallet,
	search_transactions: ReceiptText,
	spending_by_category: Wallet,
	compare_periods: ArrowUpRight,
	merchant_detail: Store,
	subscriptions: CalendarClock,
	budget_status: Target,
	unusual_charges: AlertTriangle,
	get_digest: ReceiptText,
};

/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are JSON from the worker */
type Out = any;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One tool call: a header with its state, and a card for its result. */
export function ToolCard({ part }: { part: AnyToolPart }) {
	const name = getToolName(part);
	const Icon = TOOL_ICONS[name] ?? Wrench;
	const running = part.state === "input-streaming" || part.state === "input-available";
	const out = part.state === "output-available" ? (part.output as Out) : null;
	const view = out && !out.error && !out.message ? renderOutput(name, out) : null;
	const period = describeInput(part.input);
	return (
		<div data-slot="tool-card" className="animate-rise overflow-hidden rounded-xl border border-border/70 bg-card/60 text-xs shadow-xs">
			<div className="flex items-center gap-2 px-3 py-2">
				<span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary", running && "animate-pulse")}>
					{running ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
				</span>
				<span className="font-medium text-foreground">{TOOL_LABELS[name] ?? name}</span>
				{period && <span className="truncate text-muted-foreground">· {period}</span>}
				<span className="ml-auto shrink-0 text-muted-foreground">{running ? "Looking up…" : part.state === "output-error" ? "Failed" : ""}</span>
			</div>
			{part.state === "output-error" && <p className="border-t px-3 py-2 text-destructive">{part.errorText}</p>}
			{out && (out.error || out.message) && <p className="border-t px-3 py-2 text-muted-foreground">{out.error ?? out.message}</p>}
			{view && <div className="border-t px-3 py-2.5">{view}</div>}
			{part.state === "output-available" && (
				<details className="group/raw border-t">
					<summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
						<ChevronRight className="size-3 transition-transform group-open/raw:rotate-90" /> Raw data
					</summary>
					<pre className="max-h-60 overflow-auto px-3 pb-2 break-all whitespace-pre-wrap text-muted-foreground">
						{JSON.stringify({ input: part.input, output: part.output }, null, 1)}
					</pre>
				</details>
			)}
		</div>
	);
}

function describeInput(input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	const i = input as Record<string, unknown>;
	const bits: string[] = [];
	if (typeof i.merchant === "string") bits.push(i.merchant);
	if (typeof i.category === "string") bits.push(i.category);
	if (typeof i.month === "string") bits.push(monthLabel(i.month));
	if (typeof i.a === "string" && typeof i.b === "string") bits.push(`${monthLabel(i.a, "short")} vs ${monthLabel(i.b, "short")}`);
	if (typeof i.from === "string" || typeof i.to === "string") bits.push(`${i.from ?? "…"} to ${i.to ?? "…"}`);
	return bits.length ? bits.join(" · ") : null;
}

function renderOutput(name: string, o: Out): ReactNode {
	const cur: string = o.currency ?? "EUR";
	switch (name) {
		case "get_overview":
			return o.totals ? <Overview o={o} cur={cur} /> : null;
		case "spending_by_category":
			return Array.isArray(o.categories) ? <Bars rows={o.categories.slice(0, 8).map((c: Out) => ({ label: c.category, value: c.amount, note: num(c.share) ? percent(c.share) : undefined }))} cur={cur} /> : null;
		case "compare_periods":
			return Array.isArray(o.rows) ? <Compare o={o} cur={cur} /> : null;
		case "search_transactions":
			return Array.isArray(o.transactions) ? (
				<div className="space-y-2">
					<Stats items={[["Matches", String(o.count ?? o.transactions.length)], ["Money out", money(o.total_out ?? 0, cur)], ["Money in", money(o.total_in ?? 0, cur)]]} />
					<TxList rows={o.transactions} cur={cur} />
				</div>
			) : null;
		case "unusual_charges":
			return Array.isArray(o.charges) ? <TxList rows={o.charges} cur={cur} /> : null;
		case "merchant_detail":
			return o.merchant ? <Merchant o={o} cur={cur} /> : null;
		case "subscriptions":
			return Array.isArray(o.subscriptions) ? <Subscriptions o={o} cur={cur} /> : null;
		case "budget_status":
			return o.report ? <Budgets o={o} cur={cur} /> : null;
		case "get_digest":
			return typeof o.summary === "string" ? <p className="line-clamp-4 leading-relaxed text-muted-foreground">{o.summary.replace(/[*_#]/g, "")}</p> : null;
		default:
			return null;
	}
}

function Stats({ items }: { items: [string, string, ("up" | "down" | null)?][] }) {
	return (
		<dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{items.map(([k, v, trend]) => (
				<div key={k} className="rounded-lg bg-muted/50 px-2.5 py-1.5">
					<dt className="text-[11px] text-muted-foreground">{k}</dt>
					<dd className={cn("flex items-center gap-0.5 text-sm font-semibold tabular-nums", trend === "up" && "text-destructive", trend === "down" && "text-emerald-600 dark:text-emerald-400")}>
						{trend === "up" && <ArrowUpRight className="size-3.5" />}
						{trend === "down" && <ArrowDownRight className="size-3.5" />}
						{v}
					</dd>
				</div>
			))}
		</dl>
	);
}

function Overview({ o, cur }: { o: Out; cur: string }) {
	const t = o.totals;
	const prev = o.previous_month?.totals;
	const delta = prev && num(prev.spent) && prev.spent > 0 ? (t.spent - prev.spent) / prev.spent : null;
	return (
		<div className="space-y-2.5">
			<Stats
				items={[
					["Spent", money(t.spent, cur), delta === null ? null : delta > 0 ? "up" : "down"],
					["Income", money(t.income, cur)],
					["Net", money(t.net, cur, { sign: true })],
					["vs last month", delta === null ? "—" : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`],
				]}
			/>
			{Array.isArray(o.top_categories) && o.top_categories.length > 0 && (
				<Bars rows={o.top_categories.slice(0, 5).map((c: Out) => ({ label: c.category, value: c.amount, note: num(c.share) ? percent(c.share) : undefined }))} cur={cur} />
			)}
		</div>
	);
}

function Bars({ rows, cur }: { rows: { label: string; value: number; note?: string }[]; cur: string }) {
	const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
	return (
		<ul className="space-y-1.5">
			{rows.map((r, i) => (
				<li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2">
					<span className="flex min-w-0 items-center gap-1.5">
						<CategoryDot category={r.label} />
						<span className="truncate">{r.label}</span>
					</span>
					<span className="h-2 overflow-hidden rounded-full bg-muted">
						<span
							className="animate-grow-x block h-full rounded-full"
							style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: `var(--chart-${(i % 5) + 1})`, "--i": i } as React.CSSProperties}
						/>
					</span>
					<span className="text-right tabular-nums">
						{money(r.value, cur)}
						{r.note && <span className="ml-1 text-muted-foreground">{r.note}</span>}
					</span>
				</li>
			))}
		</ul>
	);
}

function Compare({ o, cur }: { o: Out; cur: string }) {
	const [a, b] = Object.keys(o.total ?? {}).filter((k) => k !== "change");
	return (
		<div className="space-y-2">
			{a && b && (
				<Stats
					items={[
						[monthLabel(a, "short"), money(o.total[a], cur)],
						[monthLabel(b, "short"), money(o.total[b], cur)],
						["Change", money(o.total.change, cur, { sign: true }), o.total.change > 0 ? "up" : o.total.change < 0 ? "down" : null],
					]}
				/>
			)}
			<ul className="divide-y">
				{o.rows.slice(0, 8).map((r: Out) => (
					<li key={r.name} className="flex items-center gap-2 py-1">
						{o.by !== "merchant" && <CategoryDot category={r.name} />}
						<span className="min-w-0 flex-1 truncate">{r.name}</span>
						{a && b && (
							<span className="text-muted-foreground tabular-nums">
								{money(r[a], cur)} → {money(r[b], cur)}
							</span>
						)}
						<span className={cn("w-20 text-right font-medium tabular-nums", r.change > 0 ? "text-destructive" : r.change < 0 && "text-emerald-600 dark:text-emerald-400")}>
							{money(r.change, cur, { sign: true })}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function TxList({ rows, cur }: { rows: Out[]; cur: string }) {
	if (!rows.length) return <p className="text-muted-foreground">No transactions.</p>;
	return (
		<ul className="divide-y">
			{rows.slice(0, 6).map((t: Out, i: number) => (
				<li key={`${t.date}-${i}`} className="flex items-center gap-2 py-1">
					<CategoryDot category={t.category} />
					<span className="min-w-0 flex-1">
						<span className="block truncate">{t.merchant}</span>
						<span className="block truncate text-[11px] text-muted-foreground">
							{formatDate(t.date)}
							{Array.isArray(t.reasons) && t.reasons.length > 0 && ` · ${t.reasons.join(", ")}`}
						</span>
					</span>
					<span className={cn("tabular-nums", t.amount > 0 && "text-emerald-600 dark:text-emerald-400")}>{money(t.amount, cur, { sign: t.amount > 0 })}</span>
				</li>
			))}
			{rows.length > 6 && <li className="pt-1 text-muted-foreground">+{rows.length - 6} more</li>}
		</ul>
	);
}

function Merchant({ o, cur }: { o: Out; cur: string }) {
	const months = Object.entries((o.spent_by_month ?? {}) as Record<string, number>).slice(-6);
	return (
		<div className="space-y-2.5">
			<Stats
				items={[
					["Spent", money(o.spent ?? 0, cur)],
					["Payments", String(o.count ?? "—")],
					["Average", money(o.average_payment ?? 0, cur)],
					["Recurring", o.recurring ? `${money(o.recurring.monthly_amount, cur)}/mo` : "No"],
				]}
			/>
			{months.length > 1 && <Bars rows={months.map(([m, v]) => ({ label: monthLabel(m, "short"), value: v }))} cur={cur} />}
		</div>
	);
}

function Subscriptions({ o, cur }: { o: Out; cur: string }) {
	return (
		<div className="space-y-2">
			<Stats items={[["Per month", money(o.monthly_total ?? 0, cur)], ["Per year", money(o.yearly_total ?? 0, cur)], ["Active", String(o.subscriptions.length)]]} />
			<ul className="divide-y">
				{o.subscriptions.slice(0, 8).map((s: Out) => (
					<li key={s.merchant} className="flex items-center gap-2 py-1">
						<CategoryDot category={s.category} />
						<span className="min-w-0 flex-1">
							<span className="block truncate">{s.merchant}</span>
							{s.warnings?.length > 0 && (
								<span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
									<AlertTriangle className="size-3" /> {s.warnings.join(" · ")}
								</span>
							)}
						</span>
						<span className="tabular-nums">{money(s.monthly, cur)}/mo</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function Budgets({ o, cur }: { o: Out; cur: string }) {
	const cats = ((o.report.categories ?? []) as Out[]).filter((c) => num(c.budget));
	return (
		<ul className="space-y-2">
			{cats.slice(0, 8).map((c) => {
				const pct = Math.min(c.spent / c.budget, 1.5);
				return (
					<li key={c.category} className="space-y-1">
						<div className="flex items-center gap-1.5">
							<CategoryDot category={c.category} />
							<span className="flex-1 truncate">{c.category}</span>
							<span className={cn("tabular-nums", c.over && "font-medium text-destructive")}>
								{money(c.spent, cur)} / {money(c.budget, cur)}
							</span>
						</div>
						<span className="block h-1.5 overflow-hidden rounded-full bg-muted">
							<span className={cn("animate-grow-x block h-full rounded-full", c.over ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(pct, 1) * 100}%` }} />
						</span>
					</li>
				);
			})}
		</ul>
	);
}
