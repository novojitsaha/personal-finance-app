// The in-app chat: one ChatAgent Durable Object per conversation (Cloudflare
// Agents SDK, AIChatAgent). Messages are stored in the object's SQLite and
// streamed to the browser over a WebSocket; the conversations table in D1
// lists them. The model answers by calling the read-only finance tools.
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, pruneMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { load } from "../lib/data";
import { CHAT_MODEL, MAX_STEPS, chatModel, financeTools, recordStep, systemPrompt } from "./core";

/** Conversation ids are UUIDs chosen by the browser. */
export const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const textOf = (m: UIMessage) =>
	m.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join(" ")
		.trim();

export class ChatAgent extends AIChatAgent<Env> {
	maxPersistedMessages = 200;

	async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions): Promise<Response | undefined> {
		if (!CONVERSATION_ID.test(this.name)) return new Response("Invalid conversation id", { status: 400 });
		const db = this.env.DB;
		const lastUser = [...this.messages].reverse().find((m) => m.role === "user");
		await this.touch();
		const data = await load(db);
		const result = streamText({
			model: chatModel(this.env),
			system: systemPrompt(data),
			messages: pruneMessages({
				messages: await convertToModelMessages(this.messages),
				// Older tool results are dropped from the model's input to keep it short;
				// the answers that used them stay.
				toolCalls: "before-last-4-messages",
				reasoning: "before-last-message",
			}),
			tools: financeTools(db),
			stopWhen: stepCountIs(MAX_STEPS),
			abortSignal: options?.abortSignal,
			onStepFinish: ({ usage }) => recordStep(db, CHAT_MODEL, usage, { conversationId: this.name, messageId: lastUser?.id }),
		});
		return result.toUIMessageStreamResponse({ sendReasoning: false });
	}

	/** Keep the conversations list current: title from the first question, count, time. */
	private async touch() {
		const first = this.messages.find((m) => m.role === "user");
		const title = first ? textOf(first).replace(/\s+/g, " ").slice(0, 80) || "New chat" : "New chat";
		await this.env.DB.prepare(
			`INSERT INTO conversations (id, title, message_count) VALUES (?1, ?2, ?3)
			 ON CONFLICT (id) DO UPDATE SET
			   title = CASE WHEN conversations.title_set THEN conversations.title ELSE excluded.title END,
			   message_count = excluded.message_count,
			   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
			.bind(this.name, title, this.messages.filter((m) => m.role === "user").length)
			.run();
	}

	/** Delete this conversation's messages and storage (called from the API). */
	async deleteConversation(): Promise<void> {
		await this.destroy();
	}
}
