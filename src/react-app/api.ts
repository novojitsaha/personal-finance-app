import type {
	Conversation,
	UsageOverview,
	BudgetOverview,
	Dashboard,
	MerchantDetail,
	MerchantSummary,
	RecurringOverview,
	Statement,
	StatementWithTransactions,
	TransactionList,
} from "../shared/api";
import type { Category } from "../shared/categories";
import type { PreparedPdf } from "./pdf";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `Request failed (${res.status})`);
	}
	return (res.status === 204 ? undefined : await res.json()) as T;
}
const send = <T>(method: string, path: string, body?: unknown) =>
	request<T>(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const qs = (params: Record<string, string | null | undefined>) => {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
	return q.toString();
};

// Statements
export const listStatements = () => request<Statement[]>("/api/statements");
export const getStatement = (id: string) => request<StatementWithTransactions>(`/api/statements/${id}`);
export const deleteStatement = (id: string) => request<{ deleted_transactions: number }>(`/api/statements/${id}`, { method: "DELETE" });
export function uploadStatement(file: File, prepared: PreparedPdf) {
	const form = new FormData();
	form.append("file", file, file.name);
	form.append("page_count", String(prepared.pageCount));
	prepared.pageImages.forEach((img, i) => form.append("page", img, `page-${i + 1}.jpg`));
	return request<Statement>("/api/statements", { method: "POST", body: form });
}

// Dashboard and transactions
export const getDashboard = (period: string | null) => request<Dashboard>(`/api/dashboard?${qs({ period })}`);
export const listTransactions = (params: Record<string, string | null | undefined>) =>
	request<TransactionList>(`/api/transactions?${qs(params)}`);
export const setCategory = (id: string, category: Category, scope: "one" | "merchant") =>
	send<{ updated: number }>("PATCH", `/api/transactions/${id}`, { category, scope });
export const dismissFlag = (transaction_id: string, code: string) => send<void>("POST", "/api/flags/dismiss", { transaction_id, code });

// Merchants
const mk = (key: string) => encodeURIComponent(key);
export const listMerchants = () => request<MerchantSummary[]>("/api/merchants");
export const getMerchant = (key: string) => request<MerchantDetail>(`/api/merchants/${mk(key)}`);
export const renameMerchant = (key: string, name: string) =>
	send<{ merchant_key: string; merchant: string }>("POST", `/api/merchants/${mk(key)}/rename`, { name });
export const mergeMerchant = (key: string, into: string) =>
	send<{ merchant_key: string; merchant: string }>("POST", `/api/merchants/${mk(key)}/merge`, { into });
export const splitVariant = (key: string, variant_key: string, name: string) =>
	send<{ merchant_key: string }>("POST", `/api/merchants/${mk(key)}/split`, { variant_key, name });

// Recurring
export const getRecurring = () => request<RecurringOverview>("/api/recurring");
export const markRecurring = (body: { transaction_id?: string; merchant_key?: string; amount?: number }) =>
	send<{ id: number }>("POST", "/api/recurring", body);
export const deleteRecurring = (id: number) => request<void>(`/api/recurring/${id}`, { method: "DELETE" });
export const dismissSuggestion = (key: string) => send<void>("POST", `/api/recurring/suggestions/${mk(key)}/dismiss`);

// Budgets
export const getBudgets = () => request<BudgetOverview>("/api/budgets");
export const setBudget = (category: string, amount: number | null) => send<unknown>("PUT", `/api/budgets/${mk(category)}`, { amount });

export const getUsage = () => request<UsageOverview>("/api/usage");
export const listConversations = () => request<Conversation[]>("/api/conversations");
export const renameConversation = (id: string, title: string) => send<unknown>("PATCH", `/api/conversations/${id}`, { title });
export const deleteConversation = (id: string) => request<void>(`/api/conversations/${id}`, { method: "DELETE" });
