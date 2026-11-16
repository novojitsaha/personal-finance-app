// Chat with your finances. Each conversation is a ChatAgent Durable Object
// (Cloudflare Agents SDK); useAgentChat streams answers over a WebSocket and
// loads the saved messages when a conversation is reopened.
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import { ArrowLeft, ArrowUp, ChevronRight, Loader2, MessageSquarePlus, MoreHorizontal, Pencil, Square, Trash2, Wrench } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteConversation, listConversations, renameConversation } from "@/api";
import { usd } from "@/format";
import { cn } from "@/lib/utils";
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
	"How much did I spend last month, and on what?",
	"Which subscriptions went up in price?",
	"Compare my restaurant spending in the last two months.",
	"Were there any unusual charges recently?",
];

export function Chat({ params }: { params: URLSearchParams }) {
	const id = params.get("c");
	// On phones the list and the chat are separate screens (#/chat?list=1 is the list).
	const showList = params.get("list") === "1";
	const [list, setList] = useState<Conversation[] | null>(null);
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
			<aside className={cn("flex min-h-0 flex-col border-r", id && !showList && "hidden md:flex")}>
				<div className="p-3">
					<Button className="w-full justify-start" variant="outline" onClick={newChat}>
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
								<Loader2 className="size-4 animate-spin" /> Loading chat…
							</p>
						}
					>
						<ChatThread key={id} id={id} onTurnEnd={refresh} />
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
			{list === null && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
			{list?.length === 0 && <p className="px-2 text-sm text-muted-foreground">No chats yet.</p>}
			<ul className="space-y-0.5">
				{list?.map((c) => (
					<li key={c.id} className={cn("group flex items-center rounded-md hover:bg-accent", c.id === active && "bg-accent")}>
						<a className="min-w-0 flex-1 px-2 py-1.5" href={`#/chat?c=${c.id}`}>
							<span className="block truncate text-sm">{c.title}</span>
							<span className="block text-xs text-muted-foreground">
								{new Date(c.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {c.message_count} question{c.message_count === 1 ? "" : "s"} · {usd(c.cost_usd)}
							</span>
						</a>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-60 group-hover:opacity-100" aria-label={`Options for ${c.title}`}>
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

function ChatThread({ id, onTurnEnd }: { id: string; onTurnEnd: () => void }) {
	const agent = useAgent({ agent: "ChatAgent", name: id });
	const { messages, sendMessage, status, stop, error } = useAgentChat({ agent });
	const [input, setInput] = useState("");
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
		sendMessage({ text: t });
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
						<div className="space-y-4 pt-8 text-center">
							<h2 className="text-xl font-semibold">Ask about your money</h2>
							<p className="text-sm text-muted-foreground">Answers come from your uploaded statements. The assistant can read your data but not change it.</p>
							<div className="grid gap-2 sm:grid-cols-2">
								{SUGGESTIONS.map((s) => (
									<Button key={s} variant="outline" className="h-auto justify-start whitespace-normal py-2 text-left" onClick={() => send(s)}>
										{s}
									</Button>
								))}
							</div>
						</div>
					)}
					{messages.map((m) => (
						<Message key={m.id} message={m} />
					))}
					{status === "submitted" && (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Thinking…
						</p>
					)}
					{error && <p className="text-sm text-destructive">Something went wrong: {error.message}</p>}
					<div ref={bottom} />
				</div>
			</div>
			<form
				className="border-t bg-background p-3"
				onSubmit={(e) => {
					e.preventDefault();
					send(input);
				}}
			>
				<div className="mx-auto flex max-w-3xl items-end gap-2">
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
						className="max-h-40 min-h-10 resize-none"
					/>
					{busy ? (
						<Button type="button" size="icon" variant="outline" onClick={() => stop()} aria-label="Stop">
							<Square />
						</Button>
					) : (
						<Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
							<ArrowUp />
						</Button>
					)}
				</div>
			</form>
		</section>
	);
}

type ToolPart = { type: string; toolName?: string; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string };

function Message({ message }: { message: UIMessage }) {
	if (message.role === "user") {
		const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
		return (
			<div className="flex justify-end">
				<div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">{text}</div>
			</div>
		);
	}
	const tools = message.parts.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool") as unknown as ToolPart[];
	const text = message.parts
		.filter((p) => p.type === "text")
		.map((p) => (p as { text: string }).text)
		.join("\n\n");
	return (
		<div className="space-y-2">
			{text && (
				<div className="text-sm leading-relaxed [&_table]:my-2 [&_table]:w-full [&_table]:text-sm [&_td]:border-b [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold">
					<Markdown remarkPlugins={[remarkGfm]} components={{ table: (props) => <div className="overflow-x-auto"><table {...props} /></div> }}>
						{text}
					</Markdown>
				</div>
			)}
			{tools.length > 0 && <ToolsUsed tools={tools} />}
		</div>
	);
}

function ToolsUsed({ tools }: { tools: ToolPart[] }) {
	const name = (t: ToolPart) => t.toolName ?? t.type.replace(/^tool-/, "");
	const running = tools.some((t) => t.state === "input-streaming" || t.state === "input-available");
	return (
		<details className="group rounded-md border text-xs">
			<summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-muted-foreground">
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
