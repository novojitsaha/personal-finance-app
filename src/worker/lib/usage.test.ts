import { describe, expect, it } from "vitest";
import { costOf, tokensFromUsage } from "./usage";

const MODEL = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";

describe("AI usage cost", () => {
	it("prices input, cached input and output tokens", () => {
		expect(costOf(MODEL, { input: 1_000_000, cachedInput: 0, output: 0 })).toBeCloseTo(0.3);
		expect(costOf(MODEL, { input: 0, cachedInput: 0, output: 1_000_000 })).toBeCloseTo(1.2);
		expect(costOf(MODEL, { input: 1_000_000, cachedInput: 1_000_000, output: 0 })).toBeCloseTo(0.006);
		expect(costOf("@cf/unknown/model", { input: 1000, cachedInput: 0, output: 1000 })).toBe(0);
	});
	it("reads OpenAI-style and AI SDK-style usage objects", () => {
		expect(tokensFromUsage({ prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 } })).toEqual({ input: 120, cachedInput: 100, output: 30 });
		expect(tokensFromUsage({ input_tokens: 5, output_tokens: 7 })).toEqual({ input: 5, cachedInput: 0, output: 7 });
		expect(tokensFromUsage(null)).toEqual({ input: 0, cachedInput: 0, output: 0 });
	});
});
