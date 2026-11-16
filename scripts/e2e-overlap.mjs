// End-to-end check that overlapping statements of one account never create
// duplicates, and that deleting either statement keeps the other's data.
//
//   npm run dev              # in another terminal (uses real Workers AI)
//   node scripts/e2e-overlap.mjs
//
// Uses test-fixtures/overlap/: Sep-Oct and Oct-Nov statements of one ING-like
// account. October (26 transactions, incl. two identical NS charges on 14 Oct)
// is in both. Runs both upload orders, and deletes each statement in turn.
import { readFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const DIR = new URL("../test-fixtures/overlap/", import.meta.url);
const A = "overlap-ing-2026-09-10.pdf";
const B = "overlap-ing-2026-10-11.pdf";
const meta = JSON.parse(await readFile(new URL(A.replace(".pdf", ".json"), DIR), "utf8"));
const N = meta.months; // transactions per month

async function api(path, init) {
	const res = await fetch(BASE + path, init);
	const body = res.status === 204 ? null : await res.json();
	if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${JSON.stringify(body)}`);
	return body;
}
async function upload(file) {
	const form = new FormData();
	form.append("file", new Blob([await readFile(new URL(file, DIR))], { type: "application/pdf" }), file);
	const created = await api("/api/statements", { method: "POST", body: form });
	for (;;) {
		await new Promise((r) => setTimeout(r, 3000));
		const s = await api(`/api/statements/${created.id}`);
		if (s.status === "failed") throw new Error(`${file} failed: ${s.error}`);
		if (s.status === "done") return s;
	}
}
const count = (s) => api(`/api/statements/${s.id}`).then((d) => d.transactions.length);
async function accountTransactions() {
	const list = await api("/api/transactions?limit=1000");
	const ids = new Set((await api("/api/statements")).filter((s) => s.filename.startsWith("overlap-")).map((s) => s.id));
	return list.items.filter((t) => ids.has(t.statement_id));
}
async function cleanup() {
	for (const s of await api("/api/statements")) if (s.filename.startsWith("overlap-")) await api(`/api/statements/${s.id}`, { method: "DELETE" });
}

const results = [];
const check = (name, actual, expected) => {
	const ok = actual === expected;
	results.push(ok);
	console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
};

for (const [first, second, deleteFirst] of [
	[A, B, true],
	[A, B, false],
	[B, A, true],
	[B, A, false],
]) {
	await cleanup();
	const label = `${first.slice(12, 22)} then ${second.slice(12, 22)}`;
	console.log(`\n== Upload ${label}, then delete the ${deleteFirst ? "first" : "second"} ==`);
	const s1 = await upload(first);
	const s2 = await upload(second);
	const months = (f) => (f === A ? ["2026-09", "2026-10"] : ["2026-10", "2026-11"]);
	const total = (ms) => ms.reduce((a, m) => a + N[m], 0);
	check("first: transactions inserted", s1.inserted_count, total(months(first)));
	check("second: transactions on the statement", s2.transaction_count, total(months(second)));
	check("second: new (inserted)", s2.inserted_count, total(months(second)) - N["2026-10"]);
	check("second: already present (shared)", s2.shared_count, N["2026-10"]);
	check("second: listed with all its transactions", await count(s2), total(months(second)));
	const all = await accountTransactions();
	check("account: stored transactions", all.length, N["2026-09"] + N["2026-10"] + N["2026-11"]);
	check("account: identical NS charges on 14 Oct", all.filter((t) => t.date === "2026-10-14" && t.amount === -3.4).length, 2);
	const [gone, kept] = deleteFirst ? [s1, s2] : [s2, s1];
	const keptFile = deleteFirst ? second : first;
	const res = await api(`/api/statements/${gone.id}`, { method: "DELETE" });
	const left = await accountTransactions();
	check("after delete: transactions deleted", res.deleted_transactions, total(months(deleteFirst ? first : second)) - N["2026-10"]);
	check("after delete: remaining transactions", left.length, total(months(keptFile)));
	check("after delete: remaining statement lists them all", await count(kept), total(months(keptFile)));
	check("after delete: identical NS charges on 14 Oct", left.filter((t) => t.date === "2026-10-14" && t.amount === -3.4).length, 2);
}
await cleanup();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
