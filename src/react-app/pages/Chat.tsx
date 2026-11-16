// Chat with your finances. Each conversation is a ChatAgent Durable Object
// (Cloudflare Agents SDK); useAgentChat streams answers over a WebSocket and
// loads the saved messages when a conversation is reopened.
import type { UIMessage } from "ai";
import { ArrowLeft, ArrowUp, CalendarClock, ChevronRight, Loader2, MessageSquarePlus, MoreHorizontal, Pencil, ReceiptText, RotateCcw, ShieldAlert, Sparkles, Square, Trash2, Utensils, Wrench } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { deleteConversation, listConversations, renameConversation } from "@/api";
import { usd } from "@/format";
import { cn } from "@/lib/utils";
import { ChatConnectionProvider } from "@/lib/chat-connection";
import { isConnectionError, useChatConnection } from "@/lib/chat-context";
import { navigate } from "@/router";
import type { Conversation } from "../../shared/api";

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

const SUGGESTIONS = [
	{ icon: ReceiptText, text: "How much did I spend last month, and on what?" },
	{ icon: CalendarClock, text: "Which subscriptions went up in price?" },
	{ icon: Utensils, text: "Compare my restaurant spending in the last two months." },
	{ icon: ShieldAlert, text: "Were there any unusual charges recently?" },
];

export function Chat({ params }: { params: URLSearchParams }) {
	const id = params.get("c");
	// On phones the list and the chat are separate screens (#/chat?list=1 is the list).
	const showList = params.get("list") === "1";
	const [list, setList] = useState<Conversation[] | null>(null);
	// Kept here so a draft survives the chat switching from WebSocket to HTTP.
	const [draft, setDraft] = useState("");
	const refresh = useCallback(() => {
		listConversations().then(setList, (e: Error) => toast.error(e.message));
	}, []);
	useEffect(refresh, [refresh]);

	const newChat = () => navigate("/chat", { c: crypto.randomUUID() });
	// Opening the chat page starts a new conversation.
	useEffect(() => {
		if (!id && !showList) navigate("/chat", { c: crypto.randomUUID() }, true);
	}, [id, showList]);

	return (
		<div className="-m-4 grid h-[calc(100svh-3.5rem)] md:-m-6 md:grid-cols-[260px_1fr]">
			<aside className={cn("flex min-h-0 flex-col border-r border-border/60 bg-sidebar/50", id && !showList && "hidden md:flex")}>
				<div className="p-3">
					<Button className="w-full justify-start shadow-sm shadow-primary/20" onClick={newChat}>
						<MessageSquarePlus /> New chat
					</Button>
				</div>
				<ConversationList list={list} active={id} onChanged={refresh} onNew={newChat} />
			</aside>
			{id && (
				<div className={cn("flex min-h-0 flex-col", showList && "hidden md:flex")}>
					<Suspense
						fallback={
							<p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin text-primary" /> Loading chat…
							</p>
						}
					>
						<ChatConnectionProvider key={id} id={id}>
							<ChatThread id={id} onTurnEnd={refresh} input={draft} setInput={setDraft} />
						</ChatConnectionProvider>
					</Suspense>
				</div>
			)}
		</div>
	);
}

function ConversationList({ list, active, onChanged, onNew }: { list: Conversation[] | null; active: string | null; onChanged: () => void; onNew: () => void }) {
	const [renaming, setRenaming] = useState<Conversation | null>(null);
	const [title, setTitle] = useState("");
	const [deleting, setDeleting] = useState<Conversation | null>(null);
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
			<p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Recent chats</p>
			{list === null && (
				<div className="space-y-2 px-2 pt-1">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-10" />
					))}
				</div>
			)}
			{list?.length === 0 && <p className="px-2 text-sm text-muted-foreground">No chats yet.</p>}
			<ul className="space-y-0.5">
				{list?.map((c) => (
					<li key={c.id} className={cn("group flex items-center rounded-lg transition-colors hover:bg-accent/70", c.id === active && "bg-accent text-accent-foreground")}>
						<a className="min-w-0 flex-1 px-2 py-1.5" href={`#/chat?c=${c.id}`}>
							<span className="block truncate text-sm">{c.title}</span>
							<span className="block text-xs text-muted-foreground">
								{new Date(c.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {c.message_count} question{c.message_count === 1 ? "" : "s"} · {usd(c.cost_usd)}
							</span>
						</a>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="mr-0.5 size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-60" aria-label={`Options for ${c.title}`}>
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onSelect={() => {
										setTitle(c.title);
										setRenaming(c);
									}}
								>
									<Pencil /> Rename
								</DropdownMenuItem>
								<DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
									<Trash2 /> Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</li>
				))}
			</ul>

			<Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename chat</DialogTitle>
					</DialogHeader>
					<form
						onSubmit={async (e) => {
							e.preventDefault();
							if (!renaming) return;
							try {
								await renameConversation(renaming.id, title);
								setRenaming(null);
								onChanged();
							} catch (err) {
								toast.error((err as Error).message);
							}
						}}
					>
						<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus aria-label="Chat title" />
						<DialogFooter className="mt-4">
							<Button type="submit" disabled={!title.trim()}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this chat?</DialogTitle>
						<DialogDescription>“{deleting?.title}” and its messages will be deleted. This can't be undone. Its cost stays on the AI usage page.</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleting(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={async () => {
								if (!deleting) return;
								try {
									await deleteConversation(deleting.id);
									if (deleting.id === active) onNew();
									setDeleting(null);
									onChanged();
								} catch (err) {
									toast.error((err as Error).message);
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

function ChatThread({ id, onTurnEnd, input, setInput }: { id: string; onTurnEnd: () => void; input: string; setInput: (v: string) => void }) {
	const chat = useChatConnection();
	const { messages, status, error } = chat;
	const bottom = useRef<HTMLDivElement>(null);
	const busy = status === "submitted" || status === "streaming";

	const wasBusy = useRef(false);
	useEffect(() => {
		if (wasBusy.current && !busy) {
			onTurnEnd();
			// Usage rows land just after the stream ends; refresh once more for the cost.
			setTimeout(onTurnEnd, 2000);
		}
		wasBusy.current = busy;
	}, [busy, onTurnEnd]);
	useEffect(() => {
		bottom.current?.scrollIntoView({ block: "end" });
	}, [messages, status]);

	const send = (text: string) => {
		const t = text.trim();
		if (!t || busy) return;
		chat.send(t);
		setInput("");
	};

	return (
		<section className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
				<Button variant="ghost" size="sm" asChild>
					<a href={`#/chat?list=1&c=${id}`}>
						<ArrowLeft /> Chats
					</a>
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
					{messages.length === 0 && (
						<div className="space-y-5 pt-6 text-center md:pt-14">
							<span className="brand-gradient animate-float mx-auto flex size-14 items-center justify-center rounded-2xl text-white shadow-xl shadow-primary/30">
								<Sparkles className="size-7" />
							</span>
							<div className="animate-rise space-y-1.5">
								<h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
									Ask about <span className="text-brand-gradient">your money</span>
								</h2>
								<p className="mx-auto max-w-md text-sm text-pretty text-muted-foreground">Answers come from your uploaded statements. The assistant can read your data but not change it.</p>
							</div>
							<div className="grid gap-2.5 text-left sm:grid-cols-2">
								{SUGGESTIONS.map((s, i) => (
									<button
										key={s.text}
										type="button"
										data-slot="card"
										onClick={() => send(s.text)}
										style={{ "--i": i + 2 } as React.CSSProperties}
										className="card-lift animate-rise group/s flex items-start gap-3 rounded-xl bg-card p-3.5 text-left text-sm ring-1 ring-foreground/10 outline-none hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform duration-300 ease-[var(--ease-spring)] group-hover/s:scale-110">
											<s.icon className="size-4" />
										</span>
										<span className="pt-1 leading-snug">{s.text}</span>
									</button>
								))}
							</div>
						</div>
					)}
					{messages.map((m) => (
						<Message key={m.id} message={m} />
					))}
					{status === "submitted" && (
						<div className="animate-rise flex items-center gap-3 text-sm text-muted-foreground" role="status">
							<AssistantAvatar />
							<span className="typing-dots flex items-center gap-1 rounded-2xl bg-muted px-3.5 py-3" aria-label="Thinking">
								<span />
								<span />
								<span />
							</span>
						</div>
					)}
					{error && !busy && (
						<div role="alert" className="animate-rise flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-sm">
							<span className="mr-auto">
								{isConnectionError(error) ? "The connection dropped before the answer arrived. Please try again." : error.message}
							</span>
							<Button size="sm" variant="outline" onClick={() => chat.retry()}>
								<RotateCcw /> Retry
							</Button>
						</div>
					)}
					<div ref={bottom} />
				</div>
			</div>
			<form
				className="px-3 pb-3 md:pb-4"
				onSubmit={(e) => {
					e.preventDefault();
					send(input);
				}}
			>
				<div
					data-slot="card"
					className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl bg-card p-2 ring-1 ring-foreground/10 transition-shadow duration-300 focus-within:ring-2 focus-within:ring-primary/50"
				>
					<Textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								send(input);
							}
						}}
						placeholder="Ask about your spending, subscriptions, budgets…"
						aria-label="Message"
						rows={1}
						className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
					/>
					{busy ? (
						<Button type="button" size="icon" variant="outline" className="animate-pop rounded-full" onClick={() => chat.stop()} aria-label="Stop">
							<Square className="fill-current" />
						</Button>
					) : (
						<Button type="submit" size="icon" className="rounded-full transition-all duration-300 enabled:shadow-md enabled:shadow-primary/30 enabled:hover:-translate-y-0.5" disabled={!input.trim()} aria-label="Send">
							<ArrowUp />
						</Button>
					)}
				</div>
				<p className="mt-1.5 hidden text-center text-[11px] text-muted-foreground md:block">Enter to send · Shift + Enter for a new line</p>
			</form>
		</section>
	);
}

type ToolPart = { type: string; toolName?: string; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string };

function Message({ message }: { message: UIMessage }) {
	if (message.role === "user") {
		const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
		return (
			<div className="animate-rise flex justify-end">
				<div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-sm shadow-primary/20">{text}</div>
			</div>
		);
	}
	const tools = message.parts.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool") as unknown as ToolPart[];
	const text = message.parts
		.filter((p) => p.type === "text")
		.map((p) => (p as { text: string }).text)
		.join("\n\n");
	return (
		<div className="animate-rise flex gap-3">
			<AssistantAvatar />
			<div className="min-w-0 flex-1 space-y-2">
			{text && (
				<div className="text-sm leading-relaxed [&_table]:my-2 [&_table]:w-full [&_table]:text-sm [&_td]:border-b [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold">
					<Markdown remarkPlugins={[remarkGfm]} components={{ table: (props) => <div className="overflow-x-auto"><table {...props} /></div> }}>
						{text}
					</Markdown>
				</div>
			)}
			{tools.length > 0 && <ToolsUsed tools={tools} />}
			</div>
		</div>
	);
}

function AssistantAvatar() {
	return (
		<span className="brand-gradient mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm shadow-primary/30" aria-hidden>
			<Sparkles className="size-3.5" />
		</span>
	);
}

function ToolsUsed({ tools }: { tools: ToolPart[] }) {
	const name = (t: ToolPart) => t.toolName ?? t.type.replace(/^tool-/, "");
	const running = tools.some((t) => t.state === "input-streaming" || t.state === "input-available");
	return (
		<details className="group rounded-lg border border-border/70 bg-muted/30 text-xs transition-colors open:bg-muted/50">
			<summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
				<ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
				{running ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
				{running ? "Looking up your data…" : `Used ${[...new Set(tools.map((t) => TOOL_LABELS[name(t)] ?? name(t)))].join(", ")}`}
			</summary>
			<ul className="space-y-2 border-t px-3 py-2">
				{tools.map((t) => (
					<li key={t.toolCallId}>
						<p className="font-medium">
							{TOOL_LABELS[name(t)] ?? name(t)} <code className="text-muted-foreground">{name(t)}</code>
						</p>
						<pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">{JSON.stringify(t.input ?? {})}</pre>
						{t.state === "output-error" && <p className="text-destructive">{t.errorText}</p>}
						{t.state === "output-available" && (
							<details className="mt-1">
								<summary className="cursor-pointer text-muted-foreground">Result</summary>
								<pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{JSON.stringify(t.output, null, 1)}</pre>
							</details>
						)}
					</li>
				))}
			</ul>
		</details>
	);
}
