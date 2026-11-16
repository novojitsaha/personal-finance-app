import { Hono } from "hono";
import { insights } from "./routes/insights";
import { statements } from "./routes/statements";
import { usage } from "./routes/usage";
import { conversations } from "./routes/conversations";
import { routeAgentRequest } from "agents";
import { handleMcp } from "./mcp";
import { bumpDataVersion } from "./lib/cache";
import { memories } from "./routes/memories";
import { digest } from "./routes/digest";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Any successful change to the financial data (upload, delete, category,
// merchant, recurring, budget or flag changes) bumps data_version, which
// invalidates cached tool results. Chat, memory and digest routes don't.
const NOT_DATA = /^\/api\/(conversations|memories|digest|usage)\b/;
app.use("/api/*", async (c, next) => {
	await next();
	if (c.req.method !== "GET" && c.res.status < 400 && !NOT_DATA.test(c.req.path)) {
		await bumpDataVersion(c.env.DB);
	}
});
app.route("/api/statements", statements);
app.route("/api/usage", usage);
app.route("/api/conversations", conversations);
app.route("/api/memories", memories);
app.route("/api/digest", digest);
app.route("/api", insights);
app.all("/mcp", (c) => handleMcp(c.req.raw, c.env, c.executionCtx as ExecutionContext));

app.onError((err, c) => {
	console.error(err);
	return c.json({ error: "Internal error." }, 500);
});

export { StatementWorkflow } from "./workflow";
export { ChatAgent } from "./chat/agent";

export default {
	async fetch(request, env, ctx) {
		// /agents/chat-agent/<conversation id>: the chat's WebSocket and HTTP endpoints.
		return (await routeAgentRequest(request, env)) ?? app.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
