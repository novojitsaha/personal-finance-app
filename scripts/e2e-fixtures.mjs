// End-to-end extraction check: uploads the synthetic statements in
// test-fixtures/ to a running app, waits for processing, and compares the
// extracted transactions with the ground truth in test-fixtures/expected/.
//
//   npm run dev            # in another terminal (uses real Workers AI)
//   npm run test:e2e       # or: BASE_URL=http://localhost:5173 node scripts/e2e-fixtures.mjs [files...]
//
// The scanned fixture needs page images like the browser would send; on macOS
// they are rendered with Quick Look, elsewhere that fixture is skipped.
// Finally it re-uploads one statement to check that dedupe inserts nothing, and
// deletes that duplicate again.

import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const DIR = new URL("../test-fixtures/", import.meta.url).pathname;

async function api(path, init) {
	const res = await fetch(BASE + path, init);
	const body = res.status === 204 ? null : await res.json();
	if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${JSON.stringify(body)}`);
	return body;
}

function pageImages(pdfPath) {
	if (process.platform !== "darwin") return null;
	const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
	execFileSync("qlmanage", ["-t", "-s", "1754", "-o", tmp, pdfPath], { stdio: "ignore" });
	const jpg = join(tmp, "page-1.jpg");
	execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", join(tmp, basename(pdfPath) + ".png"), "--out", jpg], { stdio: "ignore" });
	return [jpg];
}

async function upload(file) {
	const path = join(DIR, file);
	const form = new FormData();
	form.append("file", new Blob([await readFile(path)], { type: "application/pdf" }), file);
	if (file.startsWith("scanned-")) {
		const images = pageImages(path);
		if (!images) return null;
		for (const img of images) form.append("page", new Blob([await readFile(img)], { type: "image/jpeg" }), basename(img));
		form.append("page_count", String(images.length));
	}
	return api("/api/statements", { method: "POST", body: form });
}

async function waitFor(id, timeoutMs = 10 * 60_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const s = await api(`/api/statements/${id}`);
		if (s.status === "done" || s.status === "failed") return { ...s, seconds: Math.round((Date.now() - start) / 1000) };
		await new Promise((r) => setTimeout(r, 3000));
	}
	throw new Error(`Timed out waiting for ${id}`);
}

const close = (a, b) => Math.abs(a - b) < 0.005;

function compare(expected, got) {
	const remaining = [...got.transactions];
	const rows = [];
	let missing = 0, signErrors = 0, dateErrors = 0;
	for (const e of expected.transactions) {
		let i = remaining.findIndex((g) => g.date === e.date && close(g.amount, e.amount));
		let issue = null;
		if (i < 0) {
			i = remaining.findIndex((g) => g.date === e.date && close(Math.abs(g.amount), Math.abs(e.amount)));
			if (i >= 0) { issue = "sign"; signErrors++; }
		}
		if (i < 0) {
			i = remaining.findIndex((g) => close(g.amount, e.amount) && normalize(g.description) === normalize(e.description));
			if (i >= 0) { issue = "date"; dateErrors++; }
		}
		if (i < 0) { missing++; rows.push({ expected: e, got: null }); continue; }
		const [g] = remaining.splice(i, 1);
		rows.push({ expected: e, got: g, issue });
	}
	const matched = rows.filter((r) => r.got);
	const exact = matched.filter((r) => r.got.category === r.expected.category).length;
	const acceptable = matched.filter((r) => r.got.category !== r.expected.category && r.expected.acceptable.includes(r.got.category)).length;
	const wrong = matched.filter((r) => !r.expected.acceptable.includes(r.got.category));
	return {
		expected: expected.transactions.length,
		extracted: got.transactions.length,
		matched: matched.filter((r) => !r.issue).length,
		signErrors,
		dateErrors,
		missing,
		extra: remaining.length,
		extraRows: remaining.map((g) => `${g.date} ${g.amount} ${g.description}`),
		missingRows: rows.filter((r) => !r.got).map((r) => `${r.expected.date} ${r.expected.amount} ${r.expected.description}`),
		categoryExact: exact,
		categoryAcceptable: acceptable,
		categoryWrong: wrong.map((r) => `${r.got.merchant ?? r.got.description}: got ${r.got.category}, expected ${r.expected.category}`),
		merchants: matched.map((r) => `${r.expected.merchant} -> ${r.got.merchant}`).filter((s) => { const [a, b] = s.split(" -> "); return normalize(a) !== normalize(b); }),
		header: {
			bank: got.bank,
			account: got.account_iban_or_name,
			period: `${got.period_start} .. ${got.period_end}` + (got.period_start === expected.start && got.period_end === expected.end ? " ok" : ` (expected ${expected.start} .. ${expected.end})`),
			opening: got.opening_balance === expected.opening ? "ok" : `${got.opening_balance} (expected ${expected.opening})`,
			closing: got.closing_balance === expected.closing ? "ok" : `${got.closing_balance} (expected ${expected.closing})`,
		},
	};
}

const normalize = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const files = process.argv.slice(2).length
	? process.argv.slice(2)
	: (await readdir(DIR)).filter((f) => f.endsWith(".pdf")).sort();

const report = [];
for (const file of files) {
	const expected = JSON.parse(await readFile(join(DIR, "expected", file.replace(/\.pdf$/, ".json")), "utf8"));
	const created = await upload(file);
	if (!created) { console.log(`${file}: skipped (needs macOS to render page images)`); continue; }
	const got = await waitFor(created.id);
	const entry = { file, id: got.id, status: got.status, seconds: got.seconds, method: got.extraction_method, warning: got.warning, error: got.error, inserted: got.inserted_count };
	if (got.status === "done") Object.assign(entry, compare(expected, got));
	report.push(entry);
	console.log(JSON.stringify(entry, null, 2));
}

// Dedupe: re-upload the first text statement; nothing new should be inserted.
const first = report.find((r) => r.status === "done" && r.method === "text");
if (first) {
	const dup = await upload(first.file);
	const got = await waitFor(dup.id);
	const ok = got.status === "done" && got.inserted_count === 0;
	console.log(`dedupe re-upload of ${first.file}: status ${got.status}, extracted ${got.transaction_count}, inserted ${got.inserted_count} -> ${ok ? "OK" : "FAIL"}`);
	await api(`/api/statements/${dup.id}`, { method: "DELETE" });
	const after = await api(`/api/statements/${first.id}`);
	console.log(`deleted duplicate statement; original still has ${after.transactions.length} transactions`);
}

console.log("\nSummary");
for (const r of report) {
	if (r.status !== "done") { console.log(`${r.file}: ${r.status} ${r.error ?? ""}`); continue; }
	console.log(
		`${r.file} [${r.method}, ${r.seconds}s]: ${r.matched}/${r.expected} exact, ${r.signErrors} sign, ${r.dateErrors} date, ${r.missing} missing, ${r.extra} extra; ` +
			`categories ${r.categoryExact} exact + ${r.categoryAcceptable} acceptable, ${r.categoryWrong.length} wrong; ` +
			`balances ${r.header.opening}/${r.header.closing}; warning: ${r.warning ? "yes" : "none"}`,
	);
}
