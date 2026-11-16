// MCP server at /mcp (Streamable HTTP, stateless) exposing the same read-only
// finance tools as the in-app chat. It is served from the custom domain, so
// Cloudflare Access protects it like the rest of the app. To let an external
// AI client connect later, add OAuth in front of it (see README, "MCP server").
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { TOOLS, type FinanceTool } from "./lib/tools";
import { load } from "./lib/data";
import { runCached } from "./lib/cache";

const INSTRUCTIONS =
	"Read-only access to one person's bank transactions (bunq, Revolut, ING statements). Amounts are in the account currency (usually EUR); negative = money out. Start with get_overview to see which months have data.";

function buildServer(db: D1Database): McpServer {
	const server = new McpServer({ name: "personal-finance", version: "1.0.0" }, { instructions: INSTRUCTIONS });
	for (const t of TOOLS as readonly FinanceTool[]) {
		server.registerTool(
			t.name,
			{ description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
			async (input: unknown) => {
				const result = await runCached(t, input, { db, source: "mcp", data: () => load(db) });
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
			},
		);
	}
	return server;
}

/** Handle a request to /mcp. */
export function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const host = new URL(request.url).hostname;
	const handler = createMcpHandler(() => buildServer(env.DB), {
		route: "/mcp",
		allowedHostnames: [host === "localhost" || host === "127.0.0.1" ? host : "finance.novojitsaha.com"],
	});
	return handler(request, env, ctx);
}
