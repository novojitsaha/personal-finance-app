// AI usage accounting: every Workers AI call is written to the ai_usage table
// (see migrations/0003_ai_usage.sql) so the AI Usage page can show costs.

/**
 * Workers AI prices in USD per million tokens. The one place to update when
 * prices change or a model is added. Unknown models are recorded at $0.
 */
export const PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
	"@cf/deepseek-ai/deepseek-v4.1-flash-1017": { input: 0.3, cachedInput: 0.006, output: 1.2 },
};

export type Feature = "extraction" | "categorization" | "chat" | "summary" | "highlights" | "digest";

export interface UsageTokens {
	input: number;
	cachedInput: number;
	output: number;
}

export interface UsageRecord extends UsageTokens {
	feature: Feature;
	task: string;
	model: string;
	ok?: boolean;
	statementId?: string | null;
	conversationId?: string | null;
	messageId?: string | null;
}

/** Cost in USD; cached input tokens are billed at the cached rate. */
export function costOf(model: string, t: UsageTokens): number {
	const p = PRICING[model];
	if (!p) return 0;
	const uncached = Math.max(0, t.input - t.cachedInput);
	return (uncached * p.input + t.cachedInput * p.cachedInput + t.output * p.output) / 1_000_000;
}

/** Token counts from a Workers AI (OpenAI-style) `usage` object. */
export function tokensFromUsage(usage: Record<string, unknown> | null | undefined): UsageTokens {
	const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
	const details = (usage?.prompt_tokens_details ?? {}) as Record<string, unknown>;
	return {
		input: n(usage?.prompt_tokens ?? usage?.input_tokens),
		cachedInput: n(details.cached_tokens ?? usage?.cached_tokens),
		output: n(usage?.completion_tokens ?? usage?.output_tokens),
	};
}

/** Store one call. Never throws: losing a usage row must not fail the work. */
export async function recordUsage(db: D1Database | undefined, r: UsageRecord): Promise<void> {
	if (!db) return;
	try {
		await db
			.prepare(
				`INSERT INTO ai_usage (feature, task, model, input_tokens, cached_input_tokens, output_tokens, cost_usd, ok, statement_id, conversation_id, message_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(r.feature, r.task, r.model, r.input, r.cachedInput, r.output, costOf(r.model, r), r.ok === false ? 0 : 1, r.statementId ?? null, r.conversationId ?? null, r.messageId ?? null)
			.run();
	} catch (err) {
		console.error("Failed to record AI usage", err);
	}
}
