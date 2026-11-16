// Browser-side PDF inspection with pdf.js, loaded on demand. For PDFs without
// a text layer (scans), pages are rendered to JPEG and uploaded alongside the
// PDF so the Worker can transcribe them with a vision model.

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_SCANNED_PAGES = 10;

export interface PreparedPdf {
	pageCount: number;
	/** Page images, only for PDFs without a text layer. */
	pageImages: Blob[];
}

export class PdfError extends Error {}

export async function preparePdf(file: File): Promise<PreparedPdf> {
	if (file.size > MAX_PDF_BYTES) throw new PdfError("is larger than 10 MB");
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) {
		throw new PdfError("is not a PDF");
	}

	const pdfjs = await import("pdfjs-dist");
	const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

	const loading = pdfjs.getDocument({ data: bytes });
	let doc;
	try {
		doc = await loading.promise;
	} catch (err) {
		const name = (err as Error)?.name;
		throw new PdfError(name === "PasswordException" ? "is password protected" : "could not be read as a PDF");
	}
	try {
		let textChars = 0;
		for (let i = 1; i <= doc.numPages && textChars < 500; i++) {
			const page = await doc.getPage(i);
			const content = await page.getTextContent();
			for (const item of content.items) if ("str" in item) textChars += item.str.trim().length;
		}
		if (textChars >= 500) return { pageCount: doc.numPages, pageImages: [] };

		// Scanned statement: render pages at ~150 dpi for OCR.
		if (doc.numPages > MAX_SCANNED_PAGES) {
			throw new PdfError(`looks scanned and has ${doc.numPages} pages; scanned statements are limited to ${MAX_SCANNED_PAGES}`);
		}
		const pageImages: Blob[] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const base = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: Math.min(3, 1240 / base.width) });
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(viewport.width);
			canvas.height = Math.round(viewport.height);
			await page.render({ canvas, viewport }).promise;
			pageImages.push(
				await new Promise<Blob>((resolve, reject) =>
					canvas.toBlob((b) => (b ? resolve(b) : reject(new PdfError("page could not be rendered"))), "image/jpeg", 0.8),
				),
			);
		}
		return { pageCount: doc.numPages, pageImages };
	} finally {
		await loading.destroy();
	}
}
