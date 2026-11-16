// The one-off rehash script must hash exactly like the Worker.
import { describe, expect, it } from "vitest";
import { accountKey, dedupeHashes } from "./extraction";
// @ts-expect-error: plain JS script without types
import * as script from "../../../scripts/rehash-dedupe.mjs";

describe("scripts/rehash-dedupe.mjs", () => {
	it("computes the same account keys and hashes as the Worker", async () => {
		const statements = [
			{ account: "NL91 INGB 0004 3862 74", bank: "ING", currency: "EUR" },
			{ account: "Current Account", bank: "Revolut", currency: "eur" },
			{ account: null, bank: null, currency: null },
		];
		const txs = [
			{ date: "2026-09-15", amount: -4.6 },
			{ date: "2026-09-15", amount: -4.6 },
			{ date: "2026-09-16", amount: 1250.004 },
		];
		for (const s of statements) {
			expect(script.accountKey(s)).toBe(accountKey(s));
			expect(script.dedupeHashes(script.accountKey(s), txs)).toEqual(await dedupeHashes(accountKey(s), txs));
		}
	});
});
