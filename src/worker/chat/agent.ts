// The in-app chat: one ChatAgent Durable Object per conversation (Cloudflare
// Agents SDK, AIChatAgent). Messages are stored in the object's SQLite and
// streamed to the browser over a WebSocket; the conversations table in D1
// lists them. The model answers by calling the read-only finance tools.
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, pruneMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { load } from "../lib/data";
import { CHAT_MODEL, MAX_STEPS, chatContext, chatModel, financeTools, recordStep, systemPrompt } from "./core";
import { extractHighlights } from "../lib/ai";

/** Highlights are saved after the conversation has been quiet this long. */
export const HIGHLIGHTS_IDLE_SECONDS = 5 * 60;

/** Conversation ids are UUIDs chosen by the browser. */
export const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const textOf = (m: UIMessage) =>
	m.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join(" ")
		.trim();

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What the user sees when answering fails, instead of a generic error. */
const readableError = (e: unknown) => `Sorry, something went wrong while answering (${errorText(e).slice(0, 200)}). Please try again.`;

export class ChatAgent extends AIChatAgent<Env> {
	maxPersistedMessages = 200;

	/** WebSocket path (useAgentChat): the SDK persists and broadcasts the answer. */
	async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions): Promise<Response | undefined> {
		if (!CONVERSATION_ID.test(this.name)) return new Response("Invalid conversation id", { status: 400 });
		const result = await this.answer(this.messages, options?.abortSignal);
		return result.toUIMessageStreamResponse({ sendReasoning: false, onError: readableError });
	}

	/**
	 * HTTP path, for networks that block WebSockets (some corporate web filters
	 * do): POST /agents/chat-agent/<id>/http-chat with the AI SDK chat request
	 * body; the answer streams back as server-sent events and is saved here, so
	 * the conversation is the same whichever path was used.
	 */
	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.method !== "POST" || !url.pathname.endsWith("/http-chat")) return super.onRequest(request);
		if (!CONVERSATION_ID.test(this.name)) return new Response("Invalid conversation id", { status: 400 });
		const body = await request.json<{ messages?: UIMessage[] }>().catch(() => ({}) as { messages?: UIMessage[] });
		const incoming = body.messages?.at(-1);
		if (!incoming || incoming.role !== "user") return Response.json({ error: "Send a user message." }, { status: 400 });
		// The server's copy is the source of truth; a retry resends a question it already has.
		const at = this.messages.findIndex((m) => m.id === incoming.id);
		const history = at >= 0 ? this.messages.slice(0, at + 1) : [...this.messages, incoming];
		await this.persistMessages(history);
		const result = await this.answer(history, request.signal);
		return result.toUIMessageStreamResponse({
			sendReasoning: false,
			originalMessages: history,
			generateMessageId: () => crypto.randomUUID(),
			onError: readableError,
			onFinish: async ({ messages }) => {
				await this.persistMessages(messages);
				await this.onChatResponse();
			},
		});
	}

	/** Stream an answer to the last question in `messages`, using the finance tools. */
	private async answer(messages: UIMessage[], abortSignal?: AbortSignal) {
		const db = this.env.DB;
		const lastUser = [...messages].reverse().find((m) => m.role === "user");
		await this.touch(messages);
		const data = await load(db);
		return streamText({
			model: chatModel(this.env),
			system: systemPrompt(data, undefined, await chatContext(db, data)),
			messages: pruneMessages({
				messages: await convertToModelMessages(messages),
				// Older tool results are dropped from the model's input to keep it short;
				// the answers that used them stay.
				toolCalls: "before-last-4-messages",
				reasoning: "before-last-message",
			}),
			tools: financeTools(db, this.name),
			stopWhen: stepCountIs(MAX_STEPS),
			abortSignal,
			onStepFinish: ({ usage }) => recordStep(db, CHAT_MODEL, usage, { conversationId: this.name, messageId: lastUser?.id }),
			onError: ({ error }) => console.error(JSON.stringify({ event: "chat_error", conversation: this.name, error: errorText(error) })),
		});
	}

	/** Keep the conversations list current: title from the first question, count, time. */
	private async touch(messages: UIMessage[]) {
		const first = messages.find((m) => m.role === "user");
		const title = first ? textOf(first).replace(/\s+/g, " ").slice(0, 80) || "New chat" : "New chat";
		await this.env.DB.prepare(
			`INSERT INTO conversations (id, title, message_count) VALUES (?1, ?2, ?3)
			 ON CONFLICT (id) DO UPDATE SET
			   title = CASE WHEN conversations.title_set THEN conversations.title ELSE excluded.title END,
			   message_count = excluded.message_count,
			   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
			.bind(this.name, title, messages.filter((m) => m.role === "user").length)
			.run();
	}

	/**
	 * After each answer, (re)schedule saving highlights for when the
	 * conversation goes quiet, so a back-and-forth costs one extraction.
	 */
	protected async onChatResponse(): Promise<void> {
		for (const s of this.getSchedules({ type: "delayed" })) {
			if (s.callback === "saveHighlights") await this.cancelSchedule(s.id);
		}
		await this.schedule(HIGHLIGHTS_IDLE_SECONDS, "saveHighlights");
	}

	/**
	 * Save durable notes from the messages not processed yet into the shared
	 * memories table (D1), de-duplicated against the existing notes.
	 */
	async saveHighlights(): Promise<{ added: number; updated: number }> {
		void this.sql`CREATE TABLE IF NOT EXISTS highlight_progress (id INTEGER PRIMARY KEY CHECK (id = 1), processed INTEGER NOT NULL)`;
		const done = this.sql<{ processed: number }>`SELECT processed FROM highlight_progress WHERE id = 1`[0]?.processed ?? 0;
		const fresh = this.messages.slice(done);
		if (!fresh.some((m) => m.role === "user")) return { added: 0, updated: 0 };
		// A little earlier context helps interpret short follow-ups.
		const context = this.messages.slice(Math.max(0, done - 2), done);
		const line = (m: UIMessage) => `${m.role === "user" ? "User" : "Assistant"}: ${textOf(m).slice(0, 1500)}`;
		const transcript = [...context.map((m) => `(earlier) ${line(m)}`), ...fresh.map(line)].filter((l) => !l.endsWith(": ")).join("\n\n");
		const db = this.env.DB;
		const { results: existing } = await db.prepare("SELECT id, kind, text FROM memories ORDER BY id").all<{ id: number; kind: string; text: string }>();
		const ctx = { ai: this.env.AI, db, conversationId: this.name };
		const h = await extractHighlights(ctx, existing, transcript).catch(() => extractHighlights(ctx, existing, transcript, 2));
		const known = new Set(existing.map((n) => n.text.toLowerCase()));
		const ids = new Set(existing.map((n) => n.id));
		const add = h.add.filter((n) => !known.has(n.text.toLowerCase()));
		const update = h.update.filter((n) => ids.has(n.id));
		const statements = [
			...add.map((n) => db.prepare("INSERT INTO memories (kind, text, source, conversation_id) VALUES (?, ?, 'ai', ?)").bind(n.kind, n.text, this.name)),
			...update.map((n) =>
				db.prepare("UPDATE memories SET kind = ?, text = ?, source = 'ai', conversation_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(n.kind, n.text, this.name, n.id),
			),
		];
		if (statements.length) await db.batch(statements);
		void this.sql`INSERT INTO highlight_progress (id, processed) VALUES (1, ${this.messages.length}) ON CONFLICT (id) DO UPDATE SET processed = excluded.processed`;
		return { added: add.length, updated: update.length };
	}

	/** Delete this conversation's messages and storage (called from the API). */
	async deleteConversation(): Promise<void> {
		await this.destroy();
	}
}
