export function money(amount: number, currency = "EUR", opts: { sign?: boolean; compact?: boolean } = {}): string {
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency,
			signDisplay: opts.sign ? "exceptZero" : "auto",
			notation: opts.compact ? "compact" : "standard",
			maximumFractionDigits: opts.compact ? 1 : 2,
		}).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${currency}`;
	}
}

export function formatDate(iso: string | null | undefined): string {
	if (!iso) return "—";
	return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function monthLabel(month: string, style: "long" | "short" = "long"): string {
	if (month === "all") return "All time";
	return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
		month: style === "long" ? "long" : "short",
		year: style === "long" ? "numeric" : "2-digit",
		timeZone: "UTC",
	});
}

export const percent = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
