# Personal Finance App

A personal finance app that analyzes bank statements and produces insights. It's under construction.

## Stack

Everything runs in a single [Cloudflare Worker](https://developers.cloudflare.com/workers/), scaffolded from Cloudflare's [`vite-react-template`](https://github.com/cloudflare/templates/tree/main/vite-react-template):

- **API:** [Hono](https://hono.dev/) (`src/worker/`)
- **Frontend:** React + Vite single-page app (`src/react-app/`)
- **D1** (`DB`): SQL database for transactions and analysis results
- **R2** (`STATEMENTS`): storage for uploaded bank statements
- **Workers AI** (`AI`): one multimodal model, [`@cf/deepseek-ai/deepseek-v4.1-flash-1017`](https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/), reads scanned pages, extracts transactions and categorizes them. It requires the Workers Paid plan.

The deployed app is served only on a custom domain behind Cloudflare Access. `workers.dev` and preview URLs are turned off.

## How statement processing works

1. **Upload** (`POST /api/statements`, multipart): the browser checks the PDF with [pdf.js](https://mozilla.github.io/pdf.js/). If it has no text layer (a scan), the browser renders up to 10 pages to JPEG and sends them along. The PDF goes to R2 at `statements/{id}.pdf`, a row goes into D1, and a [Workflow](https://developers.cloudflare.com/workflows/) instance starts.
2. **Text**: [`env.AI.toMarkdown()`](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/) extracts the PDF text. It isn't an AI model and is free for PDFs. For scans, the model transcribes each page image instead.
3. **Extraction**: the text is split into ~8k-character chunks that the model processes in parallel with a JSON schema (`response_format`). A separate call reads the header: bank, account, period and balances. Output is validated with zod. Signs are corrected from the running balance where the statement prints one. A chunk that returns fewer rows than the text clearly contains is retried with more reasoning effort.
4. **Categories**: each unique counterparty is categorized once, in a separate call, from a fixed list (see `src/shared/categories.ts`).
5. **Checks and storage**: if the statement shows opening and closing balances, the transactions must add up; otherwise the statement gets a warning. Transactions are inserted with a `dedupe_hash` (account, date, amount, occurrence), so re-uploading overlapping statements doesn't double-count.

API: `GET /api/statements`, `GET /api/statements/:id` (with transactions), `DELETE /api/statements/:id`.

## Development

```bash
npm install
npm run db:migrate:local
npm run dev
```

The app runs at http://localhost:5173. Local D1, R2 and Workflow state is kept in `.wrangler/`. Workers AI has no local simulation, so `npm run dev` calls the real models on your Cloudflare account. They're billed like production use, beyond the free daily allocation.

## Tests

```bash
npm test            # unit tests (Vitest)
npm run typecheck
npm run fixtures    # regenerate the synthetic statements in test-fixtures/
npm run test:e2e    # with `npm run dev` running: upload the fixtures and score extraction
```

`test-fixtures/` contains made-up statements in different layouts (ING-, Revolut- and Bunq-like, plus an image-only "scanned" one) with their ground truth in `test-fixtures/expected/`. Never commit real bank statements; `.gitignore` blocks PDFs outside `test-fixtures/`.

After changing `wrangler.jsonc`, regenerate binding types:

```bash
npm run cf-typegen
```

## Deploy

```bash
npm run deploy
```

Apply new D1 migrations first with `npm run db:migrate:remote`. Deploying builds the app and deploys it with Wrangler. You need to be logged in (`npx wrangler login`) to the Cloudflare account that owns the D1 database and R2 bucket in `wrangler.jsonc`.

## License

[MIT](LICENSE)
