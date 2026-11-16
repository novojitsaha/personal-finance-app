// Revolut statements ("EUR Statement", Revolut Bank UAB, BIC REVOLT21).
//
// Each currency has its own section: pages headed "<CCY> Statement", a
// "Balance summary" (opening balance, money out, money in, closing balance)
// and an "Account transactions from <date> to <date>" table with columns
// Date | Description | Money out | Money in | Balance. Continuation lines
// ("To: ...", "From: ...", "Card: ...", "Reference: ...") follow each row.
// Amounts are unsigned in separate out/in columns; the running balance lets
// us check every row. A "Pending" section, if present, is skipped (the
// statement's balances only reflect completed transactions).
import { parseAmount, parseDate, round2, textBetween } from "./pdf-text";
import { cleanMerchant } from "./merchant";
import type { BankParser, ParseResult, ParsedTransaction } from "./types";

const IBAN_RE = /\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/;
const SECTION = /^([A-Z]{3}) Statement$/;
const FOOTER = /^(Report lost|Get help|Scan the QR|Revolut Bank UAB is|©)/;

interface Section {
	currency: string;
	opening: number | null;
	closing: number | null;
	from: string | null;
	to: string | null;
	rows: (ParsedTransaction & { lastY: number; page: number; extra: string[] })[];
	dateRows: number;
}

export const revolut: BankParser = {
	id: "revolut",

	detect(lines) {
		// Page 1 must look like a Revolut statement: a "<CCY> Statement" title,
		// Revolut's own IBAN/BIC block or bank name in the header, and the
		// transaction table header. (Other banks' statements can mention
		// Revolut in transaction descriptions.)
		const page1 = lines.filter((l) => l.page === 1);
		const top = page1.filter((l) => l.y > 600).map((l) => l.text).join("\n");
		const hasTitle = page1.some((l) => l.items.some((i) => SECTION.test(i.text)));
		const isRevolut = /\bREVOLT21\b/.test(top) || /^Revolut Bank UAB/m.test(top) || /\b[A-Z]{2}\d{2}REVO/.test(top.replace(/ /g, ""));
		const hasTable = lines.some((l) => /^Date\b/.test(l.text) && /Money out/.test(l.text) && /Money in/.test(l.text));
		return hasTitle && isRevolut && hasTable;
	},

	parse(lines): ParseResult {
		// "IBAN" label with the account's IBAN as the next item on that line.
		const ibanLine = lines.find((l) => l.page === 1 && l.items.some((i) => i.text === "IBAN"));
		const ibanItem = ibanLine?.items[ibanLine.items.findIndex((i) => i.text === "IBAN") + 1];
		const account = ibanItem?.text.replace(/ /g, "").match(IBAN_RE)?.[1] ?? null;

		const sections: Section[] = [];
		let current: Section | null = null;
		let pending = false;
		let columns: { out: number; in: number; balanceEnd: number; description: number } | null = null;
		let summaryColumns: number[] | null = null;
		let pageCurrency = "EUR";

		for (const line of lines) {
			const t = line.text;
			const section = line.items.find((i) => SECTION.test(i.text))?.text.match(SECTION);
			if (section) {
				pageCurrency = section[1];
				continue;
			}
			if (line.y < 105 || FOOTER.test(t)) continue;
			if (/^Product\b.*Opening balance/i.test(t)) {
				// Balance summary header: opening | money out | money in | closing (two-line label).
				summaryColumns = line.items.slice(1).map((i) => i.x);
				continue;
			}
			if (summaryColumns && /^Account \(/.test(t)) {
				const amounts = line.items.map((i) => parseAmount(i.text)).filter((a): a is number => a !== null);
				if (amounts.length >= 4) {
					current = { currency: pageCurrency, opening: amounts[0], closing: amounts[3], from: null, to: null, rows: [], dateRows: 0 };
					sections.push(current);
				}
				summaryColumns = null;
				continue;
			}
			const range = t.match(/^(Account transactions|Transactions|Pending)\b.*from (.+?) to (.+)$/i);
			if (range) {
				pending = /^Pending/i.test(t);
				if (!pending) {
					if (!current || current.currency !== pageCurrency || current.from) {
						current = { currency: pageCurrency, opening: null, closing: null, from: null, to: null, rows: [], dateRows: 0 };
						sections.push(current);
					}
					current.from = parseDate(range[2]);
					current.to = parseDate(range[3]);
				}
				continue;
			}
			if (/^Pending\b/i.test(t)) {
				pending = true;
				continue;
			}
			if (/^Date\b/.test(t) && /Money out/.test(t) && /Balance$/.test(t)) {
				const find = (label: RegExp) => line.items.find((i) => label.test(i.text));
				const out = find(/^Money out$/);
				const inn = find(/^Money in$/);
				const bal = find(/^Balance$/);
				const desc = find(/^Description$/);
				if (out && inn && bal && desc) columns = { out: out.x - 8, in: inn.x - 8, balanceEnd: bal.xEnd, description: desc.x - 3 };
				continue;
			}
			if (!columns || !current || pending) continue;

			const first = line.items[0];
			const date = first.x < columns.description ? parseDate(first.text) : null;
			if (date) {
				current.dateRows++;
				const out = line.items.find((i) => i.x >= columns!.out && i.x < columns!.in);
				const inn = line.items.find((i) => i.x >= columns!.in && Math.abs(i.xEnd - columns!.balanceEnd) > 8);
				const bal = line.items.find((i) => Math.abs(i.xEnd - columns!.balanceEnd) <= 8);
				const outAmount = out ? parseAmount(out.text) : null;
				const inAmount = inn ? parseAmount(inn.text) : null;
				if ((outAmount === null) === (inAmount === null)) return { ok: false, reason: `row ${date} has no clear money in/out amount` };
				current.rows.push({
					date,
					description: textBetween(line, columns.description, columns.out),
					merchant: null,
					amount: outAmount !== null ? -Math.abs(outAmount) : Math.abs(inAmount!),
					currency: current.currency,
					balance: bal ? parseAmount(bal.text) : null,
					lastY: line.y,
					page: line.page,
					extra: [],
				});
				continue;
			}
			const prev = current.rows.at(-1);
			if (!prev || prev.page !== line.page || prev.lastY - line.y > 16 || first.x < columns.description - 10) continue;
			const extra = textBetween(line, columns.description, columns.out);
			if (extra) prev.extra.push(extra);
			prev.lastY = line.y;
		}

		const valid = sections.filter((s) => s.rows.length || s.dateRows);
		if (!valid.length) return { ok: false, reason: "no transactions found" };
		const transactions: ParsedTransaction[] = [];
		for (const s of valid) {
			if (s.rows.length !== s.dateRows) return { ok: false, reason: `${s.currency}: row count mismatch` };
			// Running balance check, row by row.
			let balance = s.opening;
			for (const r of s.rows) {
				if (balance !== null && r.balance !== null && Math.abs(round2(balance + r.amount) - r.balance) >= 0.005) {
					return { ok: false, reason: `${s.currency}: running balance doesn't follow on ${r.date}` };
				}
				balance = r.balance ?? (balance === null ? null : round2(balance + r.amount));
			}
			if (s.opening !== null && s.closing !== null) {
				const sum = round2(s.rows.reduce((a, r) => a + r.amount, 0));
				if (Math.abs(round2(s.opening + sum) - s.closing) >= 0.005) return { ok: false, reason: `${s.currency}: balances don't reconcile` };
			}
			for (const { lastY: _y, page: _p, extra, ...r } of s.rows) {
				// Continuation text: wrapped description, "To:"/"From:", references. Card numbers are left out.
				const wrapped = extra.filter((e) => !/^(To|From|Card|Reference|Revolut Rate|ECB rate|Fee)\b/i.test(e));
				const details = extra.filter((e) => /^(To|From|Reference):/i.test(e));
				const title = [r.description, ...wrapped].join(r.description.endsWith(".") ? "" : " ").trim();
				const counterparty = details.find((d) => /^(To|From):/i.test(d))?.replace(/^(To|From):\s*/i, "").split(",")[0];
				transactions.push({
					...r,
					description: [title, ...details].join(" · "),
					merchant: cleanMerchant(title.replace(/^(To|Payment from|Transfer from|Transfer to)\s+/i, "")) ?? cleanMerchant(counterparty ?? ""),
				});
			}
		}
		const main = valid[0];
		const dates = transactions.map((t) => t.date).sort();
		return {
			ok: true,
			statement: {
				bank: "Revolut",
				account,
				currency: main.currency,
				period_start: main.from ?? dates[0],
				period_end: main.to ?? dates.at(-1)!,
				opening_balance: main.opening,
				closing_balance: main.closing,
				transactions,
			},
		};
	},
};
