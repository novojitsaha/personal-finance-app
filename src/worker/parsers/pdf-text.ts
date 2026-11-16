// Position-aware text extraction for the deterministic bank parsers. Uses
// unpdf (a serverless build of pdf.js that runs in Workers) and groups text
// items into lines by their y position, keeping each item's x range so
// columns can be read by position. toMarkdown loses that layout.
import { getDocumentProxy } from "unpdf";

export interface TextItem {
	x: number;
	xEnd: number;
	text: string;
}

export interface TextLine {
	page: number;
	y: number;
	items: TextItem[];
	/** All items joined with single spaces. */
	text: string;
}

/** Lines of all pages, top to bottom, items left to right. */
export async function extractLines(pdf: ArrayBuffer | Uint8Array): Promise<TextLine[]> {
	// pdf.js takes ownership of (detaches) the buffer it gets, so give it a copy.
	const doc = await getDocumentProxy(new Uint8Array(pdf).slice());
	const out: TextLine[] = [];
	try {
		for (let p = 1; p <= doc.numPages; p++) {
			const page = await doc.getPage(p);
			const content = await page.getTextContent();
			const lines: { y: number; items: TextItem[] }[] = [];
			for (const raw of content.items) {
				if (!("str" in raw) || !raw.str.trim()) continue;
				const x = raw.transform[4];
				const y = raw.transform[5];
				const item = { x, xEnd: x + raw.width, text: raw.str.trim() };
				const line = lines.find((l) => Math.abs(l.y - y) <= 2);
				if (line) line.items.push(item);
				else lines.push({ y, items: [item] });
			}
			lines.sort((a, b) => b.y - a.y);
			for (const l of lines) {
				l.items.sort((a, b) => a.x - b.x);
				out.push({ page: p, y: l.y, items: l.items, text: l.items.map((i) => i.text).join(" ") });
			}
		}
	} finally {
		await doc.loadingTask.destroy();
	}
	return out;
}

/** Items of a line whose start lies in [from, to). */
export const itemsBetween = (line: TextLine, from: number, to: number) => line.items.filter((i) => i.x >= from && i.x < to);
export const textBetween = (line: TextLine, from: number, to: number) =>
	itemsBetween(line, from, to)
		.map((i) => i.text)
		.join(" ")
		.trim();

/**
 * Parse an amount as printed: "+ € 1.234,56", "- € 9,99", "€1,234.56",
 * "-€12.50", "1 234,56 EUR". The decimal separator is the last "." or ","
 * followed by exactly two digits. Returns null if it isn't an amount.
 */
export function parseAmount(raw: string): number | null {
	const s = raw.replace(/\s+/g, "");
	const m = s.match(/^([+-]?)[€$£]?([+-]?)[€$£]?(\d[\d.,]*)(?:[A-Z]{3})?$/);
	if (!m) return null;
	const sign = m[1] === "-" || m[2] === "-" ? -1 : 1;
	const num = m[3];
	const dec = num.match(/[.,](\d{2})$/);
	const intPart = (dec ? num.slice(0, -3) : num).replace(/[.,]/g, "");
	if (!/^\d+$/.test(intPart)) return null;
	return sign * Number(`${intPart}.${dec ? dec[1] : "00"}`);
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "2026-10-01", "01-10-2026", "Oct 1, 2026", "1 Oct 2026" -> "2026-10-01". */
export function parseDate(raw: string): string | null {
	const s = raw.trim();
	let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
	if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
	m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/);
	if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
	m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]*\.? (\d{4})$/);
	if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
	return null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
