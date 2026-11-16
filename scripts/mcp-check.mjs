// Calls every tool of the MCP server at /mcp and prints a short summary.
//   node scripts/mcp-check.mjs [base-url]     (default http://localhost:5173)
// Run it against a local dev server with synthetic data (npm run seed:local).
const BASE = process.argv[2] ?? "http://localhost:5173";
let id = 0;

async function rpc(method, params) {
	const res = await fetch(`${BASE}/mcp`, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
		body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
	});
	if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${await res.text()}`);
	const text = await res.text();
	const data = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
	const msg = JSON.parse(data);
	if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
	return msg.result;
}

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-check", version: "1" } });
console.log(`server: ${init.serverInfo.name} ${init.serverInfo.version}`);
const { tools } = await rpc("tools/list", {});
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

const overview = JSON.parse((await rpc("tools/call", { name: "get_overview", arguments: {} })).content[0].text);
const [a, b] = overview.months_with_data.slice(-3, -1);
const calls = {
	get_overview: { month: b },
	search_transactions: { merchant: "albert heijn", month: b, limit: 3 },
	spending_by_category: { month: b },
	compare_periods: { a, b, category: "Restaurants" },
	merchant_detail: { merchant: "Netflix" },
	subscriptions: {},
	budget_status: { month: b },
	unusual_charges: {},
};
let failed = 0;
for (const t of tools) {
	const result = await rpc("tools/call", { name: t.name, arguments: calls[t.name] ?? {} });
	const text = result.content?.[0]?.text ?? "";
	const ok = !result.isError && text.startsWith("{");
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${t.name} (${text.length} chars) ${text.slice(0, 110)}`);
}
const bad = await rpc("tools/call", { name: "get_overview", arguments: { month: "October" } });
console.log(`${bad.isError ? "ok  " : "FAIL"} invalid input is rejected`);
if (!bad.isError) failed++;
process.exit(failed ? 1 : 0);
