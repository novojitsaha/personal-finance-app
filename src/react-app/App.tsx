import { useCallback, useEffect, useRef, useState } from "react";
import type { Statement, StatementWithTransactions } from "../shared/api";
import { deleteStatement, getStatement, listStatements, uploadStatement } from "./api";
import { PdfError, preparePdf } from "./pdf";

const POLL_MS = 2500;

function App() {
	const [statements, setStatements] = useState<Statement[] | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setStatements(await listStatements());
			setError(null);
		} catch (err) {
			setError((err as Error).message);
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		listStatements().then(
			(list) => !cancelled && setStatements(list),
			(err: Error) => !cancelled && setError(err.message),
		);
		return () => {
			cancelled = true;
		};
	}, []);

	// Poll while anything is still being processed.
	const busy = statements?.some((s) => s.status === "uploaded" || s.status === "processing") ?? false;
	useEffect(() => {
		if (!busy) return;
		const timer = setInterval(() => void refresh(), POLL_MS);
		return () => clearInterval(timer);
	}, [busy, refresh]);

	return (
		<div className="page">
			<header className="top">
				<h1>Personal Finance App</h1>
				<p className="muted">Upload bank statement PDFs. Transactions are extracted and categorized automatically.</p>
			</header>

			<Upload onUploaded={refresh} />

			{error && <p className="error">{error}</p>}

			<section>
				<h2>Statements</h2>
				{statements === null ? (
					<p className="muted">Loading…</p>
				) : statements.length === 0 ? (
					<p className="muted">No statements yet.</p>
				) : (
					<StatementList
						statements={statements}
						selectedId={selectedId}
						onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
						onDeleted={(id) => {
							if (id === selectedId) setSelectedId(null);
							void refresh();
						}}
					/>
				)}
			</section>

			{selectedId && <StatementDetail key={selectedId} id={selectedId} />}
		</div>
	);
}

interface UploadItem {
	key: string;
	name: string;
	state: "reading" | "uploading" | "done" | "error";
	message?: string;
}

function Upload({ onUploaded }: { onUploaded: () => void }) {
	const [items, setItems] = useState<UploadItem[]>([]);
	const [dragging, setDragging] = useState(false);
	const input = useRef<HTMLInputElement>(null);

	const update = (key: string, patch: Partial<UploadItem>) =>
		setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

	const handleFiles = async (files: File[]) => {
		const queued = files.map((f) => ({ file: f, key: crypto.randomUUID() }));
		setItems((list) => [...queued.map(({ file, key }) => ({ key, name: file.name, state: "reading" as const })), ...list]);
		// One at a time keeps memory and AI load predictable.
		for (const { file, key } of queued) {
			try {
				const prepared = await preparePdf(file);
				update(key, {
					state: "uploading",
					message: prepared.pageImages.length ? `Scanned PDF: sending ${prepared.pageImages.length} page image(s) for OCR` : undefined,
				});
				await uploadStatement(file, prepared);
				update(key, { state: "done", message: "Uploaded. Progress is shown in the list below." });
				onUploaded();
			} catch (err) {
				update(key, { state: "error", message: err instanceof PdfError ? `This file ${err.message}.` : (err as Error).message });
			}
		}
	};

	return (
		<section>
			<div
				className={`dropzone${dragging ? " dragging" : ""}`}
				role="button"
				tabIndex={0}
				onClick={() => input.current?.click()}
				onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					void handleFiles([...e.dataTransfer.files]);
				}}
			>
				<strong>Drop PDF statements here</strong>
				<span className="muted">or click to choose files · PDF only, up to 10 MB each</span>
				<input
					ref={input}
					type="file"
					accept="application/pdf,.pdf"
					multiple
					hidden
					onChange={(e) => {
						void handleFiles([...(e.target.files ?? [])]);
						e.target.value = "";
					}}
				/>
			</div>
			{items.length > 0 && (
				<ul className="uploads">
					{items.map((i) => (
						<li key={i.key} className={i.state}>
							<span className="filename">{i.name}</span>
							<span>
								{i.state === "reading" && "Reading PDF…"}
								{i.state === "uploading" && "Uploading…"}
								{i.message && ` ${i.message}`}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function StatementList({
	statements,
	selectedId,
	onSelect,
	onDeleted,
}: {
	statements: Statement[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onDeleted: (id: string) => void;
}) {
	const remove = async (s: Statement) => {
		if (!confirm(`Delete ${s.filename} and its ${s.inserted_count ?? 0} transactions? This can't be undone.`)) return;
		try {
			await deleteStatement(s.id);
			onDeleted(s.id);
		} catch (err) {
			alert((err as Error).message);
		}
	};

	return (
		<div className="table-wrap">
			<table className="statements">
				<thead>
					<tr>
						<th>File</th>
						<th>Bank</th>
						<th>Period</th>
						<th className="num">Transactions</th>
						<th>Status</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{statements.map((s) => (
						<tr
							key={s.id}
							className={s.id === selectedId ? "selected" : undefined}
							onClick={() => s.status === "done" && onSelect(s.id)}
						>
							<td>
								<span className="filename">{s.filename}</span>
								{s.warning && <div className="warning">⚠ {s.warning}</div>}
								{s.error && <div className="error">{s.error}</div>}
							</td>
							<td>{s.bank ?? "—"}</td>
							<td className="nowrap">{s.period_start ? `${formatDate(s.period_start)} – ${formatDate(s.period_end)}` : "—"}</td>
							<td className="num">
								{s.status === "done" ? (
									<>
										{s.inserted_count}
										{s.transaction_count !== s.inserted_count && (
											<span className="muted" title="Already imported from another statement">
												{" "}
												({(s.transaction_count ?? 0) - (s.inserted_count ?? 0)} dup.)
											</span>
										)}
									</>
								) : (
									"—"
								)}
							</td>
							<td>
								<span className={`badge ${s.status}`}>{statusLabel(s)}</span>
							</td>
							<td className="actions">
								<button
									className="link danger"
									onClick={(e) => {
										e.stopPropagation();
										void remove(s);
									}}
								>
									Delete
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function StatementDetail({ id }: { id: string }) {
	const [data, setData] = useState<StatementWithTransactions | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getStatement(id).then(setData, (err: Error) => setError(err.message));
	}, [id]);

	if (error) return <p className="error">{error}</p>;
	if (!data) return <p className="muted">Loading transactions…</p>;

	const totalIn = data.transactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
	const totalOut = data.transactions.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);
	const currency = data.currency ?? "EUR";

	return (
		<section>
			<h2>{data.filename}</h2>
			<dl className="summary">
				<div>
					<dt>Account</dt>
					<dd>{data.account_iban_or_name ?? "—"}</dd>
				</div>
				<div>
					<dt>Opening balance</dt>
					<dd>{data.opening_balance !== null ? formatMoney(data.opening_balance, currency) : "—"}</dd>
				</div>
				<div>
					<dt>Money in</dt>
					<dd className="positive">{formatMoney(totalIn, currency)}</dd>
				</div>
				<div>
					<dt>Money out</dt>
					<dd>{formatMoney(totalOut, currency)}</dd>
				</div>
				<div>
					<dt>Closing balance</dt>
					<dd>{data.closing_balance !== null ? formatMoney(data.closing_balance, currency) : "—"}</dd>
				</div>
			</dl>
			{data.transaction_count !== data.inserted_count && (
				<p className="muted">
					{(data.transaction_count ?? 0) - (data.inserted_count ?? 0)} transactions were already imported from an overlapping
					statement and are listed there.
				</p>
			)}
			<div className="table-wrap">
				<table className="transactions">
					<thead>
						<tr>
							<th>Date</th>
							<th>Merchant</th>
							<th>Description</th>
							<th className="num">Amount</th>
							<th>Category</th>
						</tr>
					</thead>
					<tbody>
						{data.transactions.map((t) => (
							<tr key={t.id}>
								<td className="nowrap">{formatDate(t.date)}</td>
								<td>{t.merchant ?? "—"}</td>
								<td className="description">{t.description}</td>
								<td className={`num nowrap${t.amount > 0 ? " positive" : ""}`}>{formatMoney(t.amount, t.currency)}</td>
								<td>
									<span className="category">{t.category}</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function statusLabel(s: Statement): string {
	switch (s.status) {
		case "uploaded":
			return "Queued";
		case "processing":
			return "Processing…";
		case "done":
			return s.extraction_method === "vision" ? "Done (OCR)" : "Done";
		case "failed":
			return "Failed";
	}
}

function formatDate(iso: string | null): string {
	if (!iso) return "—";
	return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatMoney(amount: number, currency: string): string {
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${currency}`;
	}
}

export default App;
