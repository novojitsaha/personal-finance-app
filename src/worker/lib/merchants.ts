// Merchant grouping. Transactions are stored with the merchant name the model
// produced (`merchant`) and a `merchant_key` derived from it in D1. On read,
// the user's choices are applied in this order:
//   1. variant rules: a description pattern split off into its own merchant
//   2. aliases: a merchant renamed or merged into another
// so "AH 1234 AMSTERDAM", "AH TO GO 5678" and "Albert Heijn" can all count as
// Albert Heijn, and any of them can be split off again. Both are stored in D1
// and applied at read time, so they also cover future uploads.
import type { Tx } from "./analytics";
import { merchantKey } from "./analytics";

export interface Alias {
	alias_key: string;
	canonical_key: string;
	canonical_name: string;
}

export interface VariantRule {
	variant_key: string;
	merchant_name: string;
}

/** A stored transaction before merchant grouping. */
export type RawTx = Omit<Tx, "raw_merchant" | "variant_key">;

/**
 * Description pattern used to tell name variants apart: lowercase, digits and
 * punctuation removed, whitespace collapsed. "AH 1234 AMSTERDAM" and
 * "AH 5678 AMSTERDAM" are one variant; "AH TO GO 5678" is another.
 */
export function variantKey(description: string): string {
	return description
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z]+/g, " ")
		.trim()
		.split(" ")
		.slice(0, 6)
		.join(" ");
}

/**
 * Key of a merchant created by splitting off a variant. Prefixed so an alias
 * on the plain name (e.g. "ah to go" merged into Albert Heijn) doesn't pull the
 * split-off transactions straight back; the split merchant can itself still be
 * renamed or merged through an alias on this key.
 */
export const splitKey = (name: string) => `variant:${merchantKey(name, name)}`;

/** Apply variant rules and aliases; adds raw_merchant and variant_key. */
export function resolveMerchants(rows: RawTx[], aliases: Alias[], variantRules: VariantRule[]): Tx[] {
	const aliasOf = new Map(aliases.map((a) => [a.alias_key, a]));
	const variantOf = new Map(variantRules.map((v) => [v.variant_key, v.merchant_name]));
	const resolved = rows.map((t) => {
		const variant = variantKey(t.description);
		const split = variantOf.get(variant);
		let name = split ?? t.merchant ?? t.description;
		let key = split ? splitKey(split) : t.merchant_key;
		const alias = aliasOf.get(key);
		if (alias) {
			key = alias.canonical_key;
			name = alias.canonical_name;
		}
		return { ...t, raw_merchant: t.merchant, variant_key: variant, merchant_key: key, merchant: name, _aliased: !!alias || !!split };
	});
	// Without an alias, show the most common original name for each key.
	const names = new Map<string, Map<string, number>>();
	for (const t of resolved) {
		if (t._aliased || !t.merchant) continue;
		const counts = names.get(t.merchant_key) ?? new Map<string, number>();
		counts.set(t.merchant, (counts.get(t.merchant) ?? 0) + 1);
		names.set(t.merchant_key, counts);
	}
	return resolved.map(({ _aliased, ...t }) => {
		const counts = names.get(t.merchant_key);
		const name = _aliased || !counts ? t.merchant : [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
		return { ...t, merchant: name };
	});
}

/** All stored merchant_keys that currently resolve to `canonicalKey`. */
export function rawKeysFor(rows: RawTx[], resolved: Tx[], canonicalKey: string): string[] {
	const keys = new Set<string>();
	resolved.forEach((t, i) => {
		if (t.merchant_key === canonicalKey) keys.add(rows[i].merchant_key);
	});
	return [...keys];
}
