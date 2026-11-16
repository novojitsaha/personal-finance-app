// Loads the whole (personal-scale) transaction table with merchant grouping,
// recurring matches and flags applied. Shared by the API routes and the AI
// tools, so every view and every answer agrees.
import type { Category } from "../../shared/categories";
import type { TransactionRow } from "../../shared/api";
import { type Budgets, type Rule, type Tx, flags as computeFlags, mainCurrency, matchRecurring } from "./analytics";
import { type Alias, type RawTx, type VariantRule, resolveMerchants } from "./merchants";

export type Data = Awaited<ReturnType<typeof load>>;

export async function load(db: D1Database) {
	const [txs, rules, aliases, variants, dismissals, dismissedSuggestions, overrides, budgets] = await db.batch([
		db.prepare(
			`SELECT id, statement_id, date, description, merchant, merchant_key, amount, currency, category, category_source
			 FROM transactions ORDER BY date, created_at, rowid`,
		),
		db.prepare("SELECT id, merchant_key, merchant, amount, tolerance, category, created_at FROM recurring_rules ORDER BY id"),
		db.prepare("SELECT alias_key, canonical_key, canonical_name FROM merchant_aliases"),
		db.prepare("SELECT variant_key, merchant_name FROM merchant_variant_rules"),
		db.prepare("SELECT transaction_id, code FROM flag_dismissals"),
		db.prepare("SELECT merchant_key FROM dismissed_recurring_suggestions"),
		db.prepare("SELECT merchant_key, category FROM merchant_overrides"),
		db.prepare("SELECT category, amount FROM budgets"),
	]);
	const raw = txs.results as unknown as RawTx[];
	const all = resolveMerchants(raw, aliases.results as unknown as Alias[], variants.results as unknown as VariantRule[]);
	const ruleList = rules.results as unknown as Rule[];
	const matches = matchRecurring(all, ruleList);
	const dismissed = new Set((dismissals.results as { transaction_id: string; code: string }[]).map((d) => `${d.transaction_id}:${d.code}`));
	const flagMap = computeFlags(all, matches, dismissed);
	const row = (t: Tx): TransactionRow => ({
		id: t.id,
		statement_id: t.statement_id,
		date: t.date,
		description: t.description,
		merchant: t.merchant ?? t.description,
		merchant_key: t.merchant_key,
		raw_merchant: t.raw_merchant,
		amount: t.amount,
		currency: t.currency,
		category: t.category,
		category_source: t.category_source,
		recurring_rule_id: matches.get(t.id) ?? null,
		flags: flagMap.get(t.id) ?? [],
	});
	return {
		raw,
		all,
		rules: ruleList,
		matches,
		flagMap,
		row,
		aliases: aliases.results as unknown as Alias[],
		variants: variants.results as unknown as VariantRule[],
		dismissedSuggestions: new Set((dismissedSuggestions.results as { merchant_key: string }[]).map((d) => d.merchant_key)),
		overrides: new Map((overrides.results as { merchant_key: string; category: Category }[]).map((o) => [o.merchant_key, o.category])),
		budgets: Object.fromEntries((budgets.results as { category: string; amount: number }[]).map((b) => [b.category, b.amount])) as Budgets,
		currency: mainCurrency(all),
	};
}
