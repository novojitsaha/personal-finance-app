// Deterministic bank statement parsers. A parser reads the PDF's positioned
// text, parses every transaction in code and validates the result (row count,
// totals, balances). If no parser recognises the statement, or validation
// fails, the AI extraction is used instead. To support another bank, add a
// BankParser here.
import { bunq } from "./bunq";
import { extractLines } from "./pdf-text";
import { revolut } from "./revolut";
import type { BankParser, ParsedStatement } from "./types";

export const PARSERS: BankParser[] = [bunq, revolut];

export type ParserOutcome =
	| { status: "parsed"; parser: string; statement: ParsedStatement }
	| { status: "failed"; parser: string; reason: string }
	| { status: "unsupported" };

export async function parseWithBankParser(pdf: ArrayBuffer | Uint8Array): Promise<ParserOutcome> {
	let lines;
	try {
		lines = await extractLines(pdf);
	} catch {
		return { status: "unsupported" };
	}
	const parser = PARSERS.find((p) => p.detect(lines));
	if (!parser) return { status: "unsupported" };
	try {
		const result = parser.parse(lines);
		return result.ok ? { status: "parsed", parser: parser.id, statement: result.statement } : { status: "failed", parser: parser.id, reason: result.reason };
	} catch (err) {
		return { status: "failed", parser: parser.id, reason: err instanceof Error ? err.message : String(err) };
	}
}

export type { ParsedStatement } from "./types";
