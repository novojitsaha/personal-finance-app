# Personal Finance App

A personal finance app that analyzes bank statements and produces insights. It's under construction.

## Stack

Everything runs in a single [Cloudflare Worker](https://developers.cloudflare.com/workers/), scaffolded from Cloudflare's [`vite-react-template`](https://github.com/cloudflare/templates/tree/main/vite-react-template):

- **API:** [Hono](https://hono.dev/) (`src/worker/`)
- **Frontend:** React + Vite single-page app (`src/react-app/`)
- **D1** (`DB`): SQL database for transactions and analysis results
- **R2** (`STATEMENTS`): storage for uploaded bank statements
- **Workers AI** (`AI`): statement parsing and insights

The deployed app is served only on a custom domain behind Cloudflare Access. `workers.dev` and preview URLs are turned off.

## Development

```bash
npm install
npm run dev
```

The app runs at http://localhost:5173. Local D1 and R2 data is kept in `.wrangler/`. Note that Workers AI calls go to Cloudflare even in local dev.

After changing `wrangler.jsonc`, regenerate binding types:

```bash
npm run cf-typegen
```

## Deploy

```bash
npm run deploy
```

This builds the app and deploys it with Wrangler. You need to be logged in (`npx wrangler login`) to the Cloudflare account that owns the D1 database and R2 bucket in `wrangler.jsonc`.

## License

[MIT](LICENSE)
