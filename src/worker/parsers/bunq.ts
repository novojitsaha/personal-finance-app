// bunq statements (Dutch "Rekeningoverzicht" and English layout).
//
// Page 1 header: account IBAN ("IBAN: NL.. BUNQ ...", BIC BUNQNL2A), two
// balance lines ("Saldo op 2026-08-01: € 12,34" / "Balance on ..."), and
// totals of money in and out. The table has columns Datum | Rentedatum |
// Tegenrekening | Omschrijving | Bedrag (Date | Interest date | Counterparty |
// Description | Amount). Each transaction starts with a line holding the
// booking date; the counterparty's IBAN and wrapped descriptions follow on
// the next lines. Amounts are signed ("+ € 9,99", "- € 1.250,00").
import { parseAmount, round2, textBetween } from "./pdf-text";
import { cleanMerchant } from "./merchant";
import type { BankParser, ParseResult, ParsedTransaction } from "./types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const IBAN_RE = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?)\b/;
const FOOTER = /^(Aan dit overzicht|Dit product|informatie|No rights can|This product|More information|Inzicht in)/i;

export const bunq: BankParser = {
	id: "bunq",

	detect(lines) {
		// Page 1 header with bunq's BIC/IBAN or company name, and bunq's table
		// header (with the value-date column). Other banks' statements can
		// mention bunq IBANs in transactions, so a bunq IBAN alone isn't enough.
		const page1 = lines.filter((l) => l.page === 1);
		const header = page1.filter((l) => l.y > 450).map((l) => l.text).join("\n");
		const isBunq = /\bBUNQNL2A\b/i.test(header) || /^IBAN:? ?[A-Z]{2}\d{2} ?BUNQ\b/im.test(header) || /\bbunq B\.V\./.test(header);
		const hasTable = lines.some((l) => /^(Datum|Date)\b/i.test(l.text) && /(Rentedatum|Interest date)/i.test(l.text) && /(Bedrag|Amount)$/i.test(l.text));
		return isBunq && hasTable;
	},

	parse(lines): ParseResult {
		// Header: account, balances, totals.
		const ibanLine = lines.find((l) => /^IBAN:?/i.test(l.text));
		const account = ibanLine?.text.match(IBAN_RE)?.[1].replace(/ /g, "") ?? null;
		const balances = lines
			.map((l) => ({ m: l.text.match(/^(?:Saldo op|Balance on)\s+(\d{4}-\d{2}-\d{2}):?/i), l }))
			.filter((b) => b.m)
			.map((b) => ({ date: b.m![1], amount: parseAmount(b.l.items.at(-1)!.text) }));
		if (balances.length < 2 || balances.some((b) => b.amount === null)) return { ok: false, reason: "balance lines not found" };
		balances.sort((a, b) => a.date.localeCompare(b.date));
		const opening = balances[0].amount!;
		const closing = balances.at(-1)!.amount!;
		const total = (re: RegExp) => {
			const l = lines.find((x) => re.test(x.text));
			return l ? parseAmount(l.items.at(-1)!.text) : null;
		};
		const totalIn = total(/^(Totaal inkomsten|Total income)/i);
		const totalOut = total(/^(Totaal uitgaven|Total expenses|Total outgoing)/i);

		// Table header gives the description column and the amount's right edge.
		// (Date and counterparty columns are read from each row: in the Dutch
		// layout "Rentedatum Tegenrekening" is a single text item.)
		const header = lines.find(
			(l) => /^(Datum|Date)\b/i.test(l.items[0]?.text ?? "") && /(Bedrag|Amount)$/i.test(l.items.at(-1)?.text ?? "") && l.items.some((i) => /^(Omschrijving|Description)$/i.test(i.text)),
		);
		if (!header) return { ok: false, reason: "table header not found" };
		const colDescription = header.items.find((i) => /^(Omschrijving|Description)$/i.test(i.text))!.x - 3;
		const amountEnd = header.items.at(-1)!.xEnd;
		const dateColumnEnd = colDescription / 2; // dates sit well left of the counterparty

		const txs: (ParsedTransaction & { counterparty: string; lastY: number; page: number })[] = [];
		let dateRows = 0;
		for (const line of lines) {
			if (line.y < 70 || FOOTER.test(line.text) || line === header) continue;
			const first = line.items[0];
			if (first.x < dateColumnEnd && ISO.test(first.text)) {
				dateRows++;
				const amountItem = line.items.find((i) => Math.abs(i.xEnd - amountEnd) <= 8);
				const amount = amountItem ? parseAmount(amountItem.text) : null;
				if (amount === null) return { ok: false, reason: `no amount on the row of ${first.text}` };
				const second = line.items[1];
				const partyFrom = second && ISO.test(second.text) && second.x < dateColumnEnd ? second.xEnd + 1 : first.xEnd + 1;
				const counterparty = textBetween(line, partyFrom, colDescription);
				const description = line.items
					.filter((i) => i.x >= colDescription && i !== amountItem)
					.map((i) => i.text)
					.join(" ");
				txs.push({
					date: first.text,
					description,
					merchant: null,
					amount,
					currency: "EUR",
					balance: null,
					counterparty,
					lastY: line.y,
					page: line.page,
				});
				continue;
			}
			// Continuation line of the previous transaction (counterparty IBAN,
			// wrapped description), directly below it on the same page.
			const prev = txs.at(-1);
			if (!prev || prev.page !== line.page || prev.lastY - line.y > 20 || first.x < dateColumnEnd) continue;
			const extraParty = textBetween(line, 0, colDescription);
			const extraDesc = textBetween(line, colDescription, amountEnd + 10);
			if (extraParty && !IBAN_RE.test(extraParty)) prev.counterparty = `${prev.counterparty} ${extraParty}`.trim();
			if (extraDesc) prev.description = `${prev.description} ${extraDesc}`.trim();
			prev.lastY = line.y;
		}

		const transactions: ParsedTransaction[] = txs.map(({ counterparty, lastY: _y, page: _p, ...t }) => ({
			...t,
			description: [counterparty, t.description].filter(Boolean).join(" · ") || "(no description)",
			merchant: cleanMerchant(counterparty) ?? cleanMerchant(t.description),
		}));

		// Validation: every dated row parsed, totals and balances add up.
		if (!transactions.length) return { ok: false, reason: "no transactions found" };
		if (transactions.length !== dateRows) return { ok: false, reason: "row count mismatch" };
		const sumIn = round2(transactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0));
		const sumOut = round2(transactions.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0));
		if (totalIn !== null && Math.abs(sumIn - Math.abs(totalIn)) >= 0.005) return { ok: false, reason: `money in ${sumIn} != total ${totalIn}` };
		if (totalOut !== null && Math.abs(sumOut - Math.abs(totalOut)) >= 0.005) return { ok: false, reason: `money out ${sumOut} != total ${totalOut}` };
		if (Math.abs(round2(opening + sumIn - sumOut) - closing) >= 0.005) return { ok: false, reason: "balances don't reconcile" };

		return {
			ok: true,
			statement: {
				bank: "bunq",
				account,
				currency: "EUR",
				period_start: balances[0].date,
				period_end: balances.at(-1)!.date,
				opening_balance: opening,
				closing_balance: closing,
				transactions,
			},
		};
	},
};
