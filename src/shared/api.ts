// Response shapes of the /api/statements endpoints, shared by Worker and UI.
import type { Category } from "./categories";

export type StatementStatus = "uploaded" | "processing" | "done" | "failed";

export interface Statement {
	id: string;
	filename: string;
	size_bytes: number;
	page_count: number | null;
	bank: string | null;
	account_iban_or_name: string | null;
	currency: string | null;
	period_start: string | null;
	period_end: string | null;
	opening_balance: number | null;
	closing_balance: number | null;
	status: StatementStatus;
	error: string | null;
	warning: string | null;
	extraction_method: "text" | "vision" | null;
	transaction_count: number | null;
	inserted_count: number | null;
	uploaded_at: string;
	processed_at: string | null;
}

export interface Transaction {
	id: string;
	statement_id: string;
	date: string;
	description: string;
	merchant: string | null;
	amount: number;
	currency: string;
	category: Category;
	category_source: "ai" | "user";
	is_recurring: number;
}

export interface StatementWithTransactions extends Statement {
	transactions: Transaction[];
}
