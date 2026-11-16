// Fills the LOCAL D1 database with made-up data (June to mid-November 2026,
// two accounts) for development, screenshots and API checks. All data is fake.
//
//   node scripts/seed-synthetic.mjs            # uses .wrangler/state
//   node scripts/seed-synthetic.mjs --persist-to <dir>
//
// It deletes all existing rows in the local database first. It never touches
// the remote database.
//
// Built-in patterns: recurring rent, salary, gym, internet and Netflix (with a
// price increase in October); Spotify monthly but not confirmed (a recurring
// suggestion); the gym charge missing in November; an unusually large Albert
// Heijn charge; a double-charged Zalando order; a large first-time MediaMarkt
// purchase; bank fees; transfers between own accounts; Albert Heijn name
// variants ("AH", "AH to go") merged under Albert Heijn; and budgets.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const persistAt = args.indexOf("--persist-to");
const persist = persistAt >= 0 ? ["--persist-to", args[persistAt + 1]] : [];

let s = 20260601;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const between = (lo, hi) => Math.round((lo + (hi - lo) * rand()) * 100) / 100;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const lastDay = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate();
const END = "2026-11-14";
const day = (m, d) => `${m}-${String(Math.min(d, lastDay(m))).padStart(2, "0")}`;

const ING = { bank: "ING", account: "NL91 INGB 0004 3862 74", currency: "EUR", key: "NL91INGB0004386274|EUR" };
const REV = { bank: "Revolut", account: "LT12 3250 0123 4567 8910", currency: "EUR", key: "LT123250012345678910|EUR" };

const statements = [];
const txs = [];
let n = 0;
function add(acct, date, amount, merchant, description, category, source = "ai") {
	if (date > END) return;
	txs.push({ id: `seed-tx-${++n}`, acct, date, amount, merchant, description, category, source });
}

for (const m of MONTHS) {
	// ING: income, bills, groceries, transport
	add(ING, day(m, 1), -1250, "De Key", "WONINGSTICHTING DE KEY HUUR", "Rent & Housing");
	if (m !== "2026-11") add(ING, day(m, 2), -29.99, "Basic-Fit", "BASIC-FIT NEDERLAND B.V.", "Health & Fitness");
	add(ING, day(m, 3), -400, "Revolut", "NAAR REVOLUT TOP-UP", "Transfers");
	add(ING, day(m, 5), -between(92, 138), "Vattenfall", "VATTENFALL KLANTENSERVICE", "Utilities");
	add(ING, day(m, 6), -52.5, "Ziggo", "ZIGGO SERVICES BV", "Utilities");
	add(ING, day(m, 7), m >= "2026-10" ? -15.99 : -13.99, "Netflix", "NETFLIX.COM AMSTERDAM", "Subscriptions");
	add(ING, day(m, 24), 3412.55, "Acme BV", "ACME BV SALARIS", "Income");
	add(ING, day(m, 25), -300, "Savings account", "NAAR SPAARREKENING NL12INGB0001234567", "Transfers");
	add(ING, day(m, 31), -3.65, "ING", "KOSTEN BETAALPAKKET", "Fees & Charges");
	for (const d of [4, 11, 18, 25]) add(ING, day(m, d), -between(32, 78), "Albert Heijn", `ALBERT HEIJN ${pick([1021, 1234, 1408])} AMSTERDAM`, "Groceries");
	add(ING, day(m, 9), -between(8, 22), "AH", "AH 8015 UTRECHT", "Groceries");
	add(ING, day(m, 16), -between(4, 12), "AH to go", "AH TO GO 5812 CENTRAAL", "Groceries");
	for (const d of [8, 21]) add(ING, day(m, d), -between(15, 55), "Jumbo", "JUMBO SUPERMARKTEN AMSTERDAM", "Groceries");
	for (const d of [2, 10, 17, 27]) add(ING, day(m, d), -between(3.4, 24), "NS", "NS GROEP IZ NS REIZIGERS", "Transport");
	add(ING, day(m, 12), between(15, 40), "J. de Vries", "TIKKIE J. DE VRIES ETENTJE", "Transfers");

	// Revolut: card spending
	add(REV, day(m, 3), 400, "ING top-up", "TOP-UP FROM NL91INGB0004386274", "Transfers");
	add(REV, day(m, 11), -11.99, "Spotify", "SPOTIFY P2A3B4C5D6 STOCKHOLM", "Subscriptions");
	for (const d of [6, 14, 22]) add(REV, day(m, d), -between(22, 68), pick(["De Kas", "Wagamama", "Bar Centraal", "Pizzeria Napoli"]), "RESTAURANT", "Restaurants");
	for (const d of [9, 23]) add(REV, day(m, d), -between(19, 41), "Thuisbezorgd", "THUISBEZORGD.NL", "Restaurants");
	for (const d of [4, 8, 12, 19, 26]) add(REV, day(m, d), -between(3.2, 6.8), pick(["Starbucks", "Coffee Company"]), "COFFEE", "Coffee & Snacks");
	add(REV, day(m, 15), -between(14, 48), "Cafe de Klos", "CAFE DE KLOS AMSTERDAM", "Bars & Nightlife");
	add(REV, day(m, 18), -between(12, 95), pick(["bol.com", "Amazon"]), "ONLINE ORDER", "Shopping");
	add(REV, day(m, 20), -between(9, 31), pick(["Uber", "GVB"]), "RIDE", "Transport");
	if (["2026-07", "2026-09", "2026-11"].includes(m)) add(REV, day(m, 13), -between(13, 32), "Pathe", "PATHE TUSCHINSKI", "Entertainment");
	if (["2026-06", "2026-09"].includes(m)) add(REV, day(m, 27), -between(25, 90), pick(["Zara", "H&M"]), "CLOTHING", "Clothing & Fashion");
	add(REV, day(m, 28), -between(4, 26), "Kruidvat", "KRUIDVAT 7781", "Shopping");
}
// Specials
add(ING, "2026-08-14", -246.4, "KLM", "KLM ROYAL DUTCH AIRLINES", "Travel");
add(ING, "2026-08-15", -189, "Booking.com", "BOOKING.COM HOTEL RESERVATION", "Travel");
add(ING, "2026-09-19", -310.75, "Albert Heijn", "ALBERT HEIJN 1234 AMSTERDAM", "Groceries"); // unusually large
add(REV, "2026-10-08", -59.9, "Zalando", "ZALANDO SE BERLIN", "Clothing & Fashion");
add(REV, "2026-10-09", -59.9, "Zalando", "ZALANDO SE BERLIN", "Clothing & Fashion"); // likely duplicate
add(ING, "2026-10-17", -899, "MediaMarkt", "MEDIAMARKT AMSTERDAM", "Shopping"); // large first time
add(ING, "2026-11-05", -25, "UNICEF", "STICHTING UNICEF NEDERLAND", "Gifts & Donations");

// Statements: ING per month, Revolut per two months.
const groups = [
	...MONTHS.map((m) => ({ acct: ING, from: `${m}-01`, to: m === "2026-11" ? END : day(m, 31), name: `synthetic-ing-${m}.pdf` })),
	{ acct: REV, from: "2026-06-01", to: "2026-07-31", name: "synthetic-revolut-2026-06-07.pdf" },
	{ acct: REV, from: "2026-08-01", to: "2026-09-30", name: "synthetic-revolut-2026-08-09.pdf" },
	{ acct: REV, from: "2026-10-01", to: END, name: "synthetic-revolut-2026-10-11.pdf" },
];
let si = 0;
for (const g of groups) {
	const id = `seed-st-${++si}`;
	const list = txs.filter((t) => t.acct === g.acct && t.date >= g.from && t.date <= g.to);
	list.forEach((t) => (t.statement = id));
	statements.push({ id, ...g, count: list.length, inserted: list.length, links: list });
}
// An overlapping ING download (15 Oct - 14 Nov): every transaction in it was
// already imported from the monthly statements, so nothing new is inserted.
{
	const g = { acct: ING, from: "2026-10-15", to: END, name: "synthetic-ing-2026-10-15-to-11-14.pdf" };
	const list = txs.filter((t) => t.acct === ING && t.date >= g.from && t.date <= g.to);
	statements.push({ id: `seed-st-${++si}`, ...g, count: list.length, inserted: 0, links: list });
}

const sql = [
	"DELETE FROM flag_dismissals;",
	"DELETE FROM dismissed_recurring_suggestions;",
	"DELETE FROM recurring_rules;",
	"DELETE FROM merchant_overrides;",
	"DELETE FROM merchant_aliases;",
	"DELETE FROM merchant_variant_rules;",
	"DELETE FROM budgets;",
	"DELETE FROM statement_transactions;",
	"DELETE FROM transactions;",
	"DELETE FROM statements;",
];
for (const st of statements) {
	sql.push(
		`INSERT INTO statements (id, r2_key, filename, size_bytes, page_count, bank, account_iban_or_name, account_key, currency, period_start, period_end, status, extraction_method, transaction_count, inserted_count, uploaded_at, processed_at) VALUES (${[
			st.id, `statements/${st.id}.pdf`, st.name, 48213, 2, st.acct.bank, st.acct.account, st.acct.key, "EUR", st.from, st.to, "done", "text", st.count, st.inserted, `${st.to}T09:00:00.000Z`, `${st.to}T09:01:00.000Z`,
		].map(q).join(", ")});`,
	);
}
const links = statements.flatMap((st) => st.links.map((t) => `INSERT INTO statement_transactions (statement_id, transaction_id) VALUES (${q(st.id)}, ${q(t.id)});`));
for (const t of txs) {
	sql.push(
		`INSERT INTO transactions (id, statement_id, date, description, merchant, amount, currency, category, category_source, dedupe_hash) VALUES (${[
			t.id, t.statement, t.date, t.description, t.merchant, t.amount, "EUR", t.category, t.source, `seed:${t.id}`,
		].map(q).join(", ")});`,
	);
}
sql.push(...links);
sql.push(
	"INSERT INTO merchant_aliases (alias_key, canonical_key, canonical_name) VALUES ('ah', 'albert heijn', 'Albert Heijn'), ('ah to go', 'albert heijn', 'Albert Heijn');",
	"INSERT INTO recurring_rules (merchant_key, merchant, amount, tolerance, category) VALUES ('de key', 'De Key', 1250, 0.1, 'Rent & Housing'), ('netflix', 'Netflix', 13.99, 0.15, 'Subscriptions'), ('basic-fit', 'Basic-Fit', 29.99, 0.1, 'Health & Fitness'), ('ziggo', 'Ziggo', 52.5, 0.1, 'Utilities');",
	"INSERT INTO budgets (category, amount) VALUES ('*', 2300), ('Groceries', 350), ('Restaurants', 160), ('Coffee & Snacks', 25), ('Shopping', 150), ('Transport', 90);",
);

const dir = mkdtempSync(join(tmpdir(), "seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql.join("\n"));
execFileSync("npx", ["wrangler", "d1", "execute", "personal-finance-db", "--local", ...persist, "--file", file], { stdio: ["ignore", "ignore", "inherit"] });
console.log(`Seeded ${statements.length} statements and ${txs.length} transactions (synthetic) into the local database.`);
