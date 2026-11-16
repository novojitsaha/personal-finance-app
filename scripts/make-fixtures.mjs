// Generates synthetic bank statement PDFs in three different layouts, plus the
// ground truth for each, under test-fixtures/. All data is made up.
//
//   node scripts/make-fixtures.mjs
//
// On macOS it also writes a "scanned" statement: an image-only PDF without a
// text layer, rendered with Quick Look at ~150 dpi and saved as JPEG like a
// scanner would, to exercise the vision fallback.
//
// Each statement has a known opening balance, closing balance and transaction
// list, so extraction accuracy can be measured (see scripts/e2e-fixtures.mjs).

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile, readFile, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = new URL("../test-fixtures/", import.meta.url);

// Deterministic PRNG so fixtures are reproducible.
function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

// [description on statement, cleaned merchant, category, min, max, sign]
// sign: -1 money out, +1 money in. `alt` lists other categories a reasonable
// person could also pick; those count as "acceptable" rather than wrong.
const CATALOG = [
	{ d: "ALBERT HEIJN 1234 AMSTERDAM", m: "Albert Heijn", c: "Groceries", r: [8, 75] },
	{ d: "JUMBO SUPERMARKTEN AMSTERDAM", m: "Jumbo", c: "Groceries", r: [5, 60] },
	{ d: "LIDL NEDERLAND GMBH", m: "Lidl", c: "Groceries", r: [6, 40] },
	{ d: "NS GROEP IZ NS REIZIGERS", m: "NS", c: "Transport", r: [3.5, 28] },
	{ d: "GVB AMSTERDAM OV-CHIPKAART", m: "GVB", c: "Transport", r: [3.4, 20] },
	{ d: "UBER *TRIP HELP.UBER.COM", m: "Uber", c: "Transport", r: [9, 32] },
	{ d: "SPOTIFY P2A3B4C5D6 STOCKHOLM", m: "Spotify", c: "Subscriptions", r: [11.99, 11.99], alt: ["Entertainment"] },
	{ d: "NETFLIX.COM AMSTERDAM", m: "Netflix", c: "Subscriptions", r: [13.99, 13.99], alt: ["Entertainment"] },
	{ d: "BASIC-FIT NEDERLAND B.V.", m: "Basic-Fit", c: "Health & Fitness", r: [29.99, 29.99], alt: ["Subscriptions"] },
	{ d: "VATTENFALL KLANTENSERVICE", m: "Vattenfall", c: "Utilities", r: [95, 140] },
	{ d: "ZIGGO SERVICES BV", m: "Ziggo", c: "Utilities", r: [52.5, 52.5], alt: ["Subscriptions"] },
	{ d: "THUISBEZORGD.NL", m: "Thuisbezorgd", c: "Restaurants", r: [18, 42] },
	{ d: "RESTAURANT DE KAS", m: "De Kas", c: "Restaurants", r: [45, 120] },
	{ d: "STARBUCKS CENTRAAL STATION", m: "Starbucks", c: "Coffee & Snacks", r: [3.2, 7.8] },
	{ d: "COFFEE COMPANY HAARLEMMERSTR", m: "Coffee Company", c: "Coffee & Snacks", r: [2.8, 6.5] },
	{ d: "CAFE DE KLOS AMSTERDAM", m: "Cafe de Klos", c: "Bars & Nightlife", r: [14, 48], alt: ["Restaurants"] },
	{ d: "ZARA NEDERLAND BV", m: "Zara", c: "Clothing & Fashion", r: [25, 90] },
	{ d: "H&M HENNES & MAURITZ", m: "H&M", c: "Clothing & Fashion", r: [15, 70] },
	{ d: "BOL.COM BV UTRECHT", m: "bol.com", c: "Shopping", r: [12, 110] },
	{ d: "AMAZON EU SARL AMAZON.NL", m: "Amazon", c: "Shopping", r: [9, 85] },
	{ d: "KLM ROYAL DUTCH AIRLINES", m: "KLM", c: "Travel", r: [120, 340] },
	{ d: "BOOKING.COM HOTEL RESERVATION", m: "Booking.com", c: "Travel", r: [90, 260] },
	{ d: "PATHE TUSCHINSKI", m: "Pathe", c: "Entertainment", r: [13, 32] },
	{ d: "COURSERA INC", m: "Coursera", c: "Education", r: [39, 49], alt: ["Subscriptions"] },
	{ d: "STICHTING UNICEF NEDERLAND", m: "UNICEF", c: "Gifts & Donations", r: [10, 25] },
	{ d: "APOTHEEK DE MAGERE BRUG", m: "Apotheek De Magere Brug", c: "Health & Fitness", r: [6, 35] },
	{ d: "KRUIDVAT 7781", m: "Kruidvat", c: "Shopping", r: [4, 28], alt: ["Health & Fitness"] },
];
const RENT = { d: "WONINGSTICHTING DE KEY HUUR", m: "De Key", c: "Rent & Housing", r: [1250, 1250] };
const SALARY = { d: "ACME BV SALARIS", m: "Acme BV", c: "Income", r: [3412.55, 3412.55], sign: 1 };
const SAVINGS = { d: "NAAR SPAARREKENING NL12INGB0001234567", m: "Savings account", c: "Transfers", r: [300, 300] };
const TIKKIE = { d: "TIKKIE J. DE VRIES ETENTJE", m: "J. de Vries", c: "Transfers", r: [22.5, 22.5], sign: 1, alt: ["Income"] };
const FEE = { d: "KOSTEN BETAALPAKKET", m: "Bank fees", c: "Fees & Charges", r: [3.65, 3.65] };

const round2 = (n) => Math.round(n * 100) / 100;

function buildTransactions(seed, year, month, count) {
	const rand = rng(seed);
	const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const pick = (arr) => arr[Math.floor(rand() * arr.length)];
	const tx = [];
	const add = (item, day) => {
		const [lo, hi] = item.r;
		const amount = round2(lo + (hi - lo) * rand());
		tx.push({
			date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
			description: item.d,
			merchant: item.m,
			category: item.c,
			acceptable: [item.c, ...(item.alt ?? [])],
			amount: (item.sign ?? -1) * amount,
		});
	};
	add(RENT, 1);
	add(SALARY, 24);
	add(SAVINGS, 25);
	add(FEE, days);
	add(TIKKIE, 12);
	while (tx.length < count) add(pick(CATALOG), 1 + Math.floor(rand() * days));
	tx.sort((a, b) => a.date.localeCompare(b.date));
	return tx;
}

const A4 = [595.28, 841.89];

async function newDoc() {
	const doc = await PDFDocument.create();
	doc.setProducer("personal-finance-app fixtures");
	doc.setCreator("scripts/make-fixtures.mjs");
	return {
		doc,
		font: await doc.embedFont(StandardFonts.Helvetica),
		bold: await doc.embedFont(StandardFonts.HelveticaBold),
	};
}

const nl = (n) =>
	Math.abs(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const en = (n) =>
	Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nlDate = (iso) => iso.split("-").reverse().join("-");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const enDate = (iso) => {
	const [y, m, d] = iso.split("-");
	return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

function rightText(page, text, x, y, size, font) {
	page.drawText(text, { x: x - font.widthOfTextAtSize(text, size), y, size, font });
}

// Layout 1: ING-like, Dutch, table with "Af/Bij" column, unsigned amounts,
// spread over two pages.
async function ingLike(tx, meta) {
	const { doc, font, bold } = await newDoc();
	let page = doc.addPage(A4);
	let y = 790;
	const header = () => {
		page.drawText("ING", { x: 40, y: 800, size: 22, font: bold, color: rgb(1, 0.4, 0) });
		page.drawText("Afschrift betaalrekening", { x: 40, y: 775, size: 13, font: bold });
		page.drawText(`Rekening ${meta.account}  -  ${meta.holder}`, { x: 40, y: 758, size: 9, font });
		page.drawText(`Periode ${nlDate(meta.start)} t/m ${nlDate(meta.end)}   Valuta EUR`, { x: 40, y: 746, size: 9, font });
		y = 715;
		page.drawText("Datum", { x: 40, y, size: 9, font: bold });
		page.drawText("Naam / Omschrijving", { x: 110, y, size: 9, font: bold });
		page.drawText("Af/Bij", { x: 420, y, size: 9, font: bold });
		rightText(page, "Bedrag (EUR)", 555, y, 9, bold);
		y -= 18;
	};
	header();
	page.drawText(`Beginsaldo per ${nlDate(meta.start)}`, { x: 110, y, size: 9, font });
	rightText(page, nl(meta.opening), 555, y, 9, font);
	y -= 18;
	tx.forEach((t) => {
		if (y < 90) {
			page.drawText("Vervolg op volgende pagina", { x: 40, y: 40, size: 8, font });
			page = doc.addPage(A4);
			header();
		}
		page.drawText(nlDate(t.date), { x: 40, y, size: 9, font });
		page.drawText(t.description, { x: 110, y, size: 9, font });
		page.drawText(t.amount < 0 ? "Af" : "Bij", { x: 420, y, size: 9, font });
		rightText(page, nl(t.amount), 555, y, 9, font);
		y -= 12;
		page.drawText(t.amount < 0 ? "Betaalautomaat / iDEAL" : "Overschrijving", { x: 110, y, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
		y -= 14;
	});
	y -= 6;
	page.drawText(`Eindsaldo per ${nlDate(meta.end)}`, { x: 110, y, size: 9, font: bold });
	rightText(page, nl(meta.closing), 555, y, 9, bold);
	page.drawText("ING Bank N.V. - dit is een fictief testafschrift", { x: 40, y: 40, size: 7, font });
	return doc.save();
}

// Layout 2: Revolut-like, English, separate "Money out" / "Money in" columns
// and a running balance column, summary box at the top.
async function revolutLike(tx, meta) {
	const { doc, font, bold } = await newDoc();
	const page = doc.addPage(A4);
	page.drawText("Revolut", { x: 40, y: 800, size: 20, font: bold });
	page.drawText("EUR Statement", { x: 40, y: 778, size: 12, font });
	page.drawText(`Generated on the 2 ${MONTHS[Number(meta.end.slice(5, 7)) % 12]} ${meta.end.slice(0, 4)}`, { x: 400, y: 800, size: 8, font });
	page.drawText(meta.holder, { x: 40, y: 755, size: 9, font: bold });
	page.drawText(`IBAN ${meta.account}`, { x: 40, y: 743, size: 9, font });
	page.drawRectangle({ x: 40, y: 660, width: 515, height: 62, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
	page.drawText(`Balance summary  ${enDate(meta.start)} - ${enDate(meta.end)}`, { x: 50, y: 707, size: 9, font: bold });
	const out = tx.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
	const inn = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
	const cols = [["Opening balance", meta.opening], ["Money out", out], ["Money in", inn], ["Closing balance", meta.closing]];
	cols.forEach(([label, v], i) => {
		page.drawText(label, { x: 50 + i * 128, y: 688, size: 8, font });
		page.drawText(`€${en(v)}`, { x: 50 + i * 128, y: 672, size: 10, font: bold });
	});
	let y = 635;
	page.drawText("Date", { x: 40, y, size: 8, font: bold });
	page.drawText("Description", { x: 115, y, size: 8, font: bold });
	rightText(page, "Money out", 400, y, 8, bold);
	rightText(page, "Money in", 475, y, 8, bold);
	rightText(page, "Balance", 555, y, 8, bold);
	y -= 16;
	let bal = meta.opening;
	for (const t of tx) {
		bal = round2(bal + t.amount);
		page.drawText(enDate(t.date), { x: 40, y, size: 8, font });
		page.drawText(t.description.length > 40 ? t.description.slice(0, 40) : t.description, { x: 115, y, size: 8, font });
		rightText(page, t.amount < 0 ? `€${en(t.amount)}` : "", 400, y, 8, font);
		rightText(page, t.amount > 0 ? `€${en(t.amount)}` : "", 475, y, 8, font);
		rightText(page, `${bal < 0 ? "-" : ""}€${en(bal)}`, 555, y, 8, font);
		y -= 18.5;
	}
	page.drawText("Revolut Bank UAB - fictional test statement", { x: 40, y: 30, size: 7, font });
	return doc.save();
}

// Layout 3: Bunq-like, grouped by date with multi-line entries and signed
// amounts with the euro sign in front ("-€ 12,50").
async function bunqLike(tx, meta) {
	const { doc, font, bold } = await newDoc();
	let page = doc.addPage(A4);
	page.drawText("bunq", { x: 40, y: 800, size: 22, font: bold, color: rgb(0.2, 0.6, 0.3) });
	page.drawText("Account statement", { x: 40, y: 778, size: 12, font });
	page.drawText(`${meta.holder}  |  ${meta.account}  |  EUR`, { x: 40, y: 760, size: 9, font });
	page.drawText(`From ${meta.start} to ${meta.end}`, { x: 40, y: 748, size: 9, font });
	page.drawText(`Starting balance: € ${nl(meta.opening)}`, { x: 360, y: 760, size: 9, font });
	page.drawText(`Ending balance: € ${nl(meta.closing)}`, { x: 360, y: 748, size: 9, font });
	let y = 715;
	let lastDate = "";
	const sign = (n) => (n < 0 ? `-€ ${nl(n)}` : `+€ ${nl(n)}`);
	for (const t of tx) {
		if (y < 80) {
			page = doc.addPage(A4);
			y = 800;
		}
		if (t.date !== lastDate) {
			y -= 6;
			page.drawText(t.date, { x: 40, y, size: 9, font: bold });
			y -= 15;
			lastDate = t.date;
		}
		page.drawText(t.merchant, { x: 60, y, size: 9, font: bold });
		rightText(page, sign(t.amount), 555, y, 9, bold);
		y -= 11;
		page.drawText(t.description, { x: 60, y, size: 7.5, font, color: rgb(0.35, 0.35, 0.35) });
		y -= 15;
	}
	page.drawText("bunq B.V. - fictional test statement", { x: 40, y: 30, size: 7, font });
	return doc.save();
}

function statement(seed, year, month, count, opening, account, bank) {
	const tx = buildTransactions(seed, year, month, count);
	const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const mm = String(month).padStart(2, "0");
	const closing = round2(opening + tx.reduce((s, t) => s + t.amount, 0));
	return {
		bank,
		account,
		holder: "J. Jansen",
		currency: "EUR",
		start: `${year}-${mm}-01`,
		end: `${year}-${mm}-${days}`,
		opening,
		closing,
		transactions: tx,
	};
}

const fixtures = [
	{ file: "ing-like-2026-09.pdf", meta: statement(11, 2026, 9, 30, 2143.18, "NL91INGB0004386274", "ING"), render: ingLike },
	{ file: "revolut-like-2026-09.pdf", meta: statement(22, 2026, 9, 31, 1512.4, "LT12 3250 0123 4567 8910", "Revolut"), render: revolutLike },
	{ file: "bunq-like-2026-10.pdf", meta: statement(33, 2026, 10, 29, 1830.07, "NL54BUNQ2025123456", "bunq"), render: bunqLike },
];

// Two identical coffees on the same day: must NOT be collapsed by dedupe.
const ing = fixtures[0].meta;
const coffee = { date: "2026-09-15", description: "STARBUCKS CENTRAAL STATION", merchant: "Starbucks", category: "Coffee & Snacks", acceptable: ["Coffee & Snacks"], amount: -4.6 };
ing.transactions.splice(ing.transactions.findIndex((t) => t.date > coffee.date), 0, { ...coffee }, { ...coffee });
ing.closing = round2(ing.opening + ing.transactions.reduce((s, t) => s + t.amount, 0));

await mkdir(new URL("expected/", OUT), { recursive: true });
for (const f of fixtures) {
	const bytes = await f.render(f.meta.transactions, f.meta);
	await writeFile(new URL(f.file, OUT), bytes);
	await writeFile(new URL(`expected/${f.file.replace(/\.pdf$/, ".json")}`, OUT), JSON.stringify(f.meta, null, "\t") + "\n");
	console.log(`${f.file}: ${f.meta.transactions.length} transactions, opening ${f.meta.opening}, closing ${f.meta.closing}`);
}

// Overlapping statements of ONE account, as when downloading Sep-Oct and
// later Oct-Nov: October is in both. 14 Oct has two identical NS charges,
// which must be kept as two transactions but not doubled by the overlap.
{
	const account = "NL20INGB0001234599";
	const months = [9, 10, 11].map((m, i) => buildTransactions(55 + i, 2026, m, 24));
	months[1].splice(
		months[1].findIndex((t) => t.date > "2026-10-14"),
		0,
		...[0, 1].map(() => ({ date: "2026-10-14", description: "NS GROEP IZ NS REIZIGERS", merchant: "NS", category: "Transport", acceptable: ["Transport"], amount: -3.4 })),
	);
	const sum = (list) => round2(list.reduce((a, t) => a + t.amount, 0));
	const opening = 1840.25;
	const afterSep = round2(opening + sum(months[0]));
	const parts = [
		{ file: "overlap-ing-2026-09-10.pdf", tx: [...months[0], ...months[1]], start: "2026-09-01", end: "2026-10-31", opening },
		{ file: "overlap-ing-2026-10-11.pdf", tx: [...months[1], ...months[2]], start: "2026-10-01", end: "2026-11-30", opening: afterSep },
	];
	await mkdir(new URL("overlap/", OUT), { recursive: true });
	for (const p of parts) {
		const meta = { bank: "ING", account, holder: "J. Jansen", currency: "EUR", start: p.start, end: p.end, opening: p.opening, closing: round2(p.opening + sum(p.tx)), transactions: p.tx };
		await writeFile(new URL(`overlap/${p.file}`, OUT), await ingLike(p.tx, { ...meta, account: "NL20 INGB 0001 2345 99" }));
		await writeFile(new URL(`overlap/${p.file.replace(/\.pdf$/, ".json")}`, OUT), JSON.stringify({ ...meta, months: { "2026-09": months[0].length, "2026-10": months[1].length, "2026-11": months[2].length } }, null, "\t") + "\n");
		console.log(`overlap/${p.file}: ${p.tx.length} transactions (${p.start} to ${p.end})`);
	}
}

// Scanned statement: a separate Revolut-like statement (other account and
// month, so it isn't deduped against the text one), rasterized to an image.
if (process.platform === "darwin") {
	const meta = statement(44, 2026, 10, 28, 940.15, "LT98 3250 0987 6543 2101", "Revolut");
	const tmp = await mkdtemp(join(tmpdir(), "scan-"));
	const src = join(tmp, "source.pdf");
	await writeFile(src, await revolutLike(meta.transactions, meta));
	execFileSync("qlmanage", ["-t", "-s", "1754", "-o", tmp, src], { stdio: "ignore" });
	const jpg = join(tmp, "page.jpg");
	execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", join(tmp, "source.pdf.png"), "--out", jpg], { stdio: "ignore" });
	const doc = await PDFDocument.create();
	const img = await doc.embedJpg(await readFile(jpg));
	doc.addPage(A4).drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
	const file = "scanned-revolut-like-2026-10.pdf";
	await writeFile(new URL(file, OUT), await doc.save());
	await writeFile(new URL(`expected/${file.replace(/\.pdf$/, ".json")}`, OUT), JSON.stringify(meta, null, "\t") + "\n");
	console.log(`${file}: ${meta.transactions.length} transactions (image only), opening ${meta.opening}, closing ${meta.closing}`);
} else {
	console.log("Skipping the scanned fixture (needs macOS qlmanage/sips).");
}
