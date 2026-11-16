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

/** Workers AI bills in USD; small amounts get more decimals. */
export function usd(n: number | null | undefined): string {
	if (n == null) return "—";
	if (n === 0) return "$0";
	const digits = Math.abs(n) < 0.01 ? 4 : Math.abs(n) < 1 ? 3 : 2;
	return `$${n.toFixed(digits)}`;
}
