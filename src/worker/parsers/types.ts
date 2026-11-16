import type { TextLine } from "./pdf-text";

export interface ParsedTransaction {
	date: string;
	description: string;
	merchant: string | null;
	amount: number;
	currency: string;
	balance: number | null;
}

/** Same shape as the AI extraction's merged result (without categories). */
export interface ParsedStatement {
	bank: string;
	account: string | null;
	currency: string;
	period_start: string | null;
	period_end: string | null;
	opening_balance: number | null;
	closing_balance: number | null;
	transactions: ParsedTransaction[];
}

export type ParseResult = { ok: true; statement: ParsedStatement } | { ok: false; reason: string };

export interface BankParser {
	/** Short id, stored as extraction_method "parser:<id>". */
	id: string;
	/** Does this text belong to a statement this parser understands? */
	detect(lines: TextLine[]): boolean;
	/** Parse and validate; a failure means "fall back to AI extraction". */
	parse(lines: TextLine[]): ParseResult;
}
