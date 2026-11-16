// The chat's model setup, shared by the chat agent (agent.ts) and the
// tool-calling evaluation (eval.eval.ts): system prompt, the finance tools as
// AI SDK tools, and per-step usage recording.
import { createAI } from "agents/models/ai-sdk";
import { type LanguageModelUsage, type ToolSet, tool } from "ai";
import { TOOLS, type FinanceTool } from "../lib/tools";
import { type Data, load } from "../lib/data";
import { months as monthsOf } from "../lib/analytics";
import { recordUsage } from "../lib/usage";

/** The model the chat uses (see the 4b PR for the tool-calling comparison). */
export const CHAT_MODEL = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
export const CHAT_REASONING: "low" | "medium" | "high" | null = "low";
/** Max model calls per question (tool calls plus the final answer). */
export const MAX_STEPS = 8;

export function chatModel(env: { AI: Ai }, model: string = CHAT_MODEL, reasoningEffort = CHAT_REASONING) {
	const ai = createAI({ binding: env.AI });
	return ai(model as never, { reasoningEffort });
}

export function systemPrompt(data: Data, today = new Date().toISOString().slice(0, 10), extra = ""): string {
	const months = monthsOf(data.all);
	return `You are the assistant in a personal finance app. You answer questions about one person's bank transactions (their own uploaded bunq, Revolut and ING statements) by calling the tools, which read the app's database.

Today is ${today}. Data covers ${months.length ? `${months[0]} to ${months.at(-1)} (months: ${months.join(", ")})` : "no months yet: no statements have been uploaded"}. Amounts are in ${data.currency}; in tool results negative amounts are money out.

Rules:
- Every number you state must come from a tool result in this conversation. Never guess or invent amounts, dates or merchants. If the tools can't answer, say so.
- Call tools as needed, several if useful (e.g. a merchant's spending in two months). Prefer one well-filtered call over many.
- "Spending" excludes transfers between own accounts and to friends, and excludes income; the tools already apply this.
- Months are YYYY-MM. "This month" / "last month" refer to ${months.at(-1) ?? "the latest month with data"} and the month before, unless the user means the calendar month.
- Answer briefly and directly: lead with the answer, then a few supporting facts. Use short lists or a small table when comparing. Format money like €1,234.56.
- You can't change data (categories, budgets, merchants); point the user to the right page instead.${extra ? `\n\n${extra}` : ""}`;
}

/**
 * The finance tools as AI SDK tools. The data is loaded once per question and
 * shared by all tool calls of that question.
 */
export function financeTools(db: D1Database): ToolSet {
	let data: Promise<Data> | null = null;
	const get = () => (data ??= load(db));
	return Object.fromEntries(
		(TOOLS as readonly FinanceTool[]).map((t) => [
			t.name,
			tool({
				description: t.description,
				inputSchema: t.inputSchema,
				execute: async (input: unknown) => t.execute(await get(), input as never),
			}),
		]),
	);
}

/** Record one model call (a step) of a chat answer. */
export function recordStep(db: D1Database, model: string, usage: LanguageModelUsage, ids: { conversationId?: string; messageId?: string; feature?: "chat" | "summary" | "highlights" | "digest"; task?: string }) {
	return recordUsage(db, {
		feature: ids.feature ?? "chat",
		task: ids.task ?? "chat",
		model,
		input: usage.inputTokens ?? 0,
		cachedInput: usage.inputTokenDetails?.cacheReadTokens ?? 0,
		output: usage.outputTokens ?? 0,
		conversationId: ids.conversationId,
		messageId: ids.messageId,
	});
}
