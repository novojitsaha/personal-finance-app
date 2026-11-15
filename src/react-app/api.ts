import type { Statement, StatementWithTransactions } from "../shared/api";
import type { PreparedPdf } from "./pdf";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `Request failed (${res.status})`);
	}
	return (res.status === 204 ? undefined : await res.json()) as T;
}

export const listStatements = () => request<Statement[]>("/api/statements");

export const getStatement = (id: string) => request<StatementWithTransactions>(`/api/statements/${id}`);

export const deleteStatement = (id: string) => request<void>(`/api/statements/${id}`, { method: "DELETE" });

export function uploadStatement(file: File, prepared: PreparedPdf) {
	const form = new FormData();
	form.append("file", file, file.name);
	form.append("page_count", String(prepared.pageCount));
	prepared.pageImages.forEach((img, i) => form.append("page", img, `page-${i + 1}.jpg`));
	return request<Statement>("/api/statements", { method: "POST", body: form });
}
