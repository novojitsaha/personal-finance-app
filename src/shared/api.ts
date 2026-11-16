// Response shapes of the /api/statements endpoints, shared by Worker and UI.
import type { Category, GroupName } from "./categories";

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
	/** Transactions this statement shares with other statements (overlap). */
	shared_count?: number;
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

// ---------------------------------------------------------------------------
// Step 3: dashboard, transactions, merchants, recurring, budgets, flags
// ---------------------------------------------------------------------------


export interface DashboardKpis {
	spent: number;
	income: number;
	net: number;
	transfers_in: number;
	transfers_out: number;
	count: number;
}

export interface CategoryAmount {
	category: Category;
	group: GroupName;
	amount: number;
	/** Share of total spending, 0..1. */
	share: number;
}

export interface MerchantAmount {
	merchant: string;
	merchant_key: string;
	category: Category;
	amount: number;
	count: number;
}

export interface TrendMonth {
	month: string;
	income: number;
	spent: number;
	groups: Record<GroupName, number>;
}

export interface Flag {
	code: "large_vs_usual" | "first_time_large" | "possible_duplicate" | "price_up" | "bank_fee";
	reason: string;
}

export interface FlaggedTransaction extends TransactionRow {
	flags: Flag[];
}

export interface Dashboard {
	/** "YYYY-MM" or "all". */
	period: string;
	months: string[];
	currency: string;
	kpis: DashboardKpis;
	/** Previous month's KPIs, for month views. */
	previous: DashboardKpis | null;
	by_category: CategoryAmount[];
	/** Previous month's spending per category, for month views. */
	previous_by_category: CategoryAmount[];
	top_merchants: MerchantAmount[];
	trend: TrendMonth[];
	flagged: { count: number; items: FlaggedTransaction[] };
}

/** A transaction as listed in the app, with merchant grouping applied. */
export interface TransactionRow {
	id: string;
	statement_id: string;
	date: string;
	description: string;
	merchant: string;
	merchant_key: string;
	raw_merchant: string | null;
	amount: number;
	currency: string;
	category: Category;
	category_source: "ai" | "user";
	recurring_rule_id: number | null;
	flags: Flag[];
}

export interface TransactionList {
	total: number;
	items: TransactionRow[];
}

export interface MerchantSummary {
	merchant: string;
	merchant_key: string;
	count: number;
	spent: number;
}

export interface MerchantVariant {
	variant_key: string;
	example: string;
	raw_merchant: string | null;
	count: number;
	total: number;
	/** True when split off from another merchant by the user. */
	split: boolean;
}

export interface MerchantDetail {
	merchant: string;
	merchant_key: string;
	category: Category;
	currency: string;
	count: number;
	spent: number;
	received: number;
	average: number;
	first_date: string;
	last_date: string;
	by_month: { month: string; spent: number }[];
	variants: MerchantVariant[];
	transactions: TransactionRow[];
	recurring_rule_id: number | null;
	override: Category | null;
}

export interface Subscription {
	id: number;
	merchant: string;
	merchant_key: string;
	category: Category;
	monthly: number;
	yearly: number;
	tolerance: number;
	charges: number;
	last_date: string | null;
	last_amount: number | null;
	currency: string;
	warnings: { code: "price_up" | "missed"; message: string }[];
}

export interface RecurringSuggestion {
	merchant_key: string;
	merchant: string;
	category: Category;
	amount: number;
	months: number;
	count: number;
	last_date: string;
	currency: string;
	transaction_id: string;
}

export interface RecurringOverview {
	currency: string;
	subscriptions: Subscription[];
	suggestions: RecurringSuggestion[];
	monthly_total: number;
	yearly_total: number;
}

export interface BudgetLine {
	category: Category;
	spent: number;
	budget: number;
	/** budget - spent; negative when over. */
	diff: number;
	over: boolean;
}

export interface BudgetMonth {
	month: string;
	total: { spent: number; budget: number | null; diff: number | null; over: boolean | null };
	categories: BudgetLine[];
}

export interface BudgetOverview {
	currency: string;
	/** Category -> monthly budget; "*" is the overall budget. */
	budgets: Record<string, number>;
	months: BudgetMonth[];
}
