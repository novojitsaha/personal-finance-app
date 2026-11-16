/// <reference types="node" />
// Tool-calling evaluation for the chat model, on the SYNTHETIC local data
// (npm run seed:local). Calls real Workers AI (billed). Run:
//
//   npm run eval:chat                        # the default chat model
//   EVAL_MODELS="@cf/a,@cf/b" npm run eval:chat
//
// Each question checks that the model called a sensible tool and that the
// answer contains the right number (taken from the tools themselves).
import { writeFileSync } from "node:fs";
import { generateText, stepCountIs } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { load } from "../lib/data";
import { runTool } from "../lib/tools";
import { CHAT_MODEL, MAX_STEPS, chatModel, financeTools, systemPrompt } from "./core";
import { costOf } from "../lib/usage";

type Truth = (t: (name: string, input: object) => Promise<any>) => Promise<{ numbers: number[]; tools: string[] }>; // eslint-disable-line @typescript-eslint/no-explicit-any

const r = (n: number) => Math.round(n * 100) / 100;

const QUESTIONS: [string, Truth][] = [
	["How much did I spend at Albert Heijn in October?", async (t) => ({ numbers: [(await t("search_transactions", { merchant: "Albert Heijn", month: "2026-10" })).total_out], tools: ["search_transactions", "merchant_detail"] })],
	["Which subscriptions went up in price?", async () => ({ numbers: [], tools: ["subscriptions"] })],
	["Compare my restaurant spending in September and October.", async (t) => {
		const c = await t("compare_periods", { a: "2026-09", b: "2026-10", category: "Restaurants" });
		return { numbers: [c.total["2026-09"], c.total["2026-10"]], tools: ["compare_periods", "spending_by_category", "search_transactions", "get_overview"] };
	}],
	["What did I spend in total in October?", async (t) => ({ numbers: [(await t("get_overview", { month: "2026-10" })).totals.spent], tools: ["get_overview", "spending_by_category"] })],
	["What was my biggest spending category in September, and how much?", async (t) => ({ numbers: [(await t("spending_by_category", { month: "2026-09" })).categories[0].amount], tools: ["spending_by_category", "get_overview"] })],
	["Am I over budget anywhere in October?", async () => ({ numbers: [], tools: ["budget_status"] })],
	["Were there any unusual charges in October?", async () => ({ numbers: [], tools: ["unusual_charges", "get_overview"] })],
	["How much do my subscriptions cost per month in total?", async (t) => ({ numbers: [(await t("subscriptions", {})).monthly_total], tools: ["subscriptions"] })],
	["When did I last pay Netflix, and how much was it?", async (t) => ({ numbers: [Math.abs((await t("merchant_detail", { merchant: "Netflix" })).latest[0].amount)], tools: ["merchant_detail", "search_transactions", "subscriptions"] })],
	["How much did I spend on groceries in August?", async (t) => ({ numbers: [(await t("search_transactions", { category: "Groceries", month: "2026-08", direction: "out" })).total_out], tools: ["search_transactions", "spending_by_category"] })],
	["What were my 3 largest purchases in October?", async (t) => {
		const s = await t("search_transactions", { month: "2026-10", direction: "out", sort: "largest", limit: 3 });
		return { numbers: s.transactions.map((x: { amount: number }) => Math.abs(x.amount)), tools: ["search_transactions"] };
	}],
	["How much income did I get in July?", async (t) => ({ numbers: [(await t("get_overview", { month: "2026-07" })).totals.income], tools: ["get_overview", "search_transactions"] })],
	["Was I charged twice for anything?", async () => ({ numbers: [], tools: ["unusual_charges", "search_transactions"] })],
	["How much have I spent on transport over all my data?", async (t) => ({ numbers: [(await t("spending_by_category", {})).categories.find((c: { category: string }) => c.category === "Transport")?.amount ?? 0], tools: ["spending_by_category", "search_transactions", "get_overview"] })],
	["How much did I save in September?", async (t) => ({ numbers: [(await t("get_overview", { month: "2026-09" })).totals.net], tools: ["get_overview"] })],
	["Where did I spend the most money in October?", async (t) => ({ numbers: [(await t("get_overview", { month: "2026-10" })).top_merchants[0].amount], tools: ["get_overview", "search_transactions", "spending_by_category"] })],
];

/** Does the text contain the amount, in any common format (1,234.56 / 1234.56 / 1.234,56 / 1234.6)? */
function mentions(text: string, n: number): boolean {
	const plain = text.replace(/[\s\u00a0\u202f]/g, "");
	const v = Math.abs(r(n));
	const fixed = v.toFixed(2);
	const [int, dec] = fixed.split(".");
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	const variants = [fixed, `${grouped}.${dec}`, `${int},${dec}`, `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`, String(Math.round(v)), grouped];
	if (dec === "00") variants.push(int, grouped);
	return variants.some((x) => plain.includes(x));
}

const MODELS = (process.env.EVAL_MODELS ?? CHAT_MODEL).split(",");
const results: Record<string, unknown>[] = [];
let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

beforeAll(async () => {
	proxy = await getPlatformProxy<Env>({ configPath: "wrangler.jsonc" });
});
afterAll(async () => {
	await proxy?.dispose();
	writeFileSync(process.env.EVAL_OUT ?? "chat-eval.local.json", JSON.stringify(results, null, 2));
	for (const m of MODELS) {
		const rows = results.filter((x) => x.model === m);
		const pass = rows.filter((x) => x.pass).length;
		const cost = rows.reduce((a, x) => a + (x.cost as number), 0);
		const secs = rows.reduce((a, x) => a + (x.seconds as number), 0);
		console.log(`${m}: ${pass}/${rows.length} pass, avg ${(secs / rows.length).toFixed(1)} s, avg $${(cost / rows.length).toFixed(4)} per question`);
	}
});

for (const model of MODELS) {
	describe(model, () => {
		for (const [question, truth] of QUESTIONS) {
			it(question, async () => {
				const db = proxy.env.DB;
				const t = (name: string, input: object) => runTool(db, name, input) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
				const want = await truth(t);
				const start = Date.now();
				let error: string | null = null;
				let text = "";
				let calls: string[] = [];
				let cost = 0;
				try {
					const res = await generateText({
						model: chatModel(proxy.env, model),
						system: systemPrompt(await load(db), "2026-11-16"),
						prompt: question,
						tools: financeTools(db),
						stopWhen: stepCountIs(MAX_STEPS),
					});
					text = res.text;
					calls = res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
					for (const s of res.steps) cost += costOf(model, { input: s.usage.inputTokens ?? 0, cachedInput: s.usage.inputTokenDetails?.cacheReadTokens ?? 0, output: s.usage.outputTokens ?? 0 });
				} catch (e) {
					error = e instanceof Error ? e.message : String(e);
				}
				const usedTool = calls.some((c) => want.tools.includes(c));
				const missing = want.numbers.filter((n) => !mentions(text, n));
				const pass = !error && usedTool && missing.length === 0 && text.trim().length > 0;
				results.push({ model, question, pass, error, calls, missing, seconds: (Date.now() - start) / 1000, cost, answer: text });
				expect.soft(error).toBeNull();
				expect.soft(usedTool, `tools called: ${calls.join(", ") || "none"}`).toBe(true);
				expect.soft(missing, `answer: ${text.slice(0, 300)}`).toEqual([]);
			});
		}
	});
}
