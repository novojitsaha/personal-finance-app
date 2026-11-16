// One-off data migration for step 3: the dedupe hash now uses a normalized
// account key (IBAN, or bank + account name) plus the statement currency.
// Recomputes dedupe_hash for transactions stored before that change, from
// data already in D1 (statement account/bank/currency, transaction
// date/amount), so re-uploading an old statement is still recognised, and
// fills statements.account_key.
//
//   node scripts/rehash-dedupe.mjs --local | --remote [--dry-run]
//
// The hashing below must stay identical to accountKey()/dedupeHashes() in
// src/worker/lib/extraction.ts (rehash-dedupe.test.ts checks that).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const normalizeAccount = (s) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/;

export function accountKey({ account, bank, currency }) {
	const iban = (account ?? "").toUpperCase().match(IBAN)?.[0].replace(/ /g, "");
	const base = iban ?? `${normalizeAccount(bank)}:${normalizeAccount(account)}`;
	return `${base}|${(currency ?? "").toUpperCase()}`;
}

export function dedupeHashes(account, transactions) {
	const seen = new Map();
	return transactions.map((t) => {
		const base = [account, t.date, (Math.round(t.amount * 100) / 100).toFixed(2)].join("|");
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return createHash("sha256").update(`${base}|${n}`).digest("hex");
	});
}

function d1(target, args) {
	const out = execFileSync("npx", ["wrangler", "d1", "execute", "personal-finance-db", target, "--json", ...args], { encoding: "utf8" });
	return JSON.parse(out)[0]?.results ?? [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const target = process.argv.includes("--remote") ? "--remote" : "--local";
	const dry = process.argv.includes("--dry-run");
	const rows = d1(target, [
		"--command",
		`SELECT t.id, t.date, t.amount, t.dedupe_hash, s.account_iban_or_name AS account, s.bank, s.currency, s.id AS statement_id
		 FROM transactions t JOIN statements s ON s.id = t.statement_id
		 ORDER BY s.id, t.created_at, t.rowid`,
	]);
	const byStatement = new Map();
	for (const r of rows) byStatement.set(r.statement_id, [...(byStatement.get(r.statement_id) ?? []), r]);
	const updates = [];
	for (const [statementId, list] of byStatement) {
		const key = accountKey(list[0]);
		updates.push(`UPDATE statements SET account_key = '${key.replace(/'/g, "''")}' WHERE id = '${statementId.replace(/'/g, "''")}' AND account_key IS NULL;`);
		const hashes = dedupeHashes(key, list);
		list.forEach((r, i) => {
			if (r.dedupe_hash !== hashes[i] && !r.dedupe_hash.startsWith("seed:")) updates.push(`UPDATE transactions SET dedupe_hash = '${hashes[i]}' WHERE id = '${r.id.replace(/'/g, "''")}';`);
		});
	}
	console.log(`${rows.length} transactions in ${byStatement.size} statements; ${updates.length - byStatement.size} hashes to update; account_key set where missing.`);
	if (!dry && updates.length) {
		const file = join(mkdtempSync(join(tmpdir(), "rehash-")), "rehash.sql");
		writeFileSync(file, updates.join("\n"));
		execFileSync("npx", ["wrangler", "d1", "execute", "personal-finance-db", target, "--file", file], { stdio: "inherit" });
		console.log("Updated.");
	}
}
