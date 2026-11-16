// Chat conversations: list, rename, delete. Messages live in each
// conversation's ChatAgent Durable Object (see chat/agent.ts).
import { getAgentByName } from "agents";
import { Hono } from "hono";
import type { Conversation } from "../../shared/api";
import { CONVERSATION_ID } from "../chat/agent";

type Env = { Bindings: Cloudflare.Env };
export const conversations = new Hono<Env>();

conversations.get("/", async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT c.id, c.title, c.message_count, c.created_at, c.updated_at,
		        (SELECT sum(cost_usd) FROM ai_usage u WHERE u.conversation_id = c.id) AS cost_usd
		 FROM conversations c WHERE c.message_count > 0 ORDER BY c.updated_at DESC LIMIT 200`,
	).all<Conversation>();
	return c.json(results.map((r) => ({ ...r, cost_usd: r.cost_usd ?? 0 })));
});

conversations.patch("/:id", async (c) => {
	const id = c.req.param("id");
	const { title } = await c.req.json<{ title?: string }>().catch(() => ({ title: undefined }));
	const clean = (title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
	if (!CONVERSATION_ID.test(id) || !clean) return c.json({ error: "A title is required." }, 400);
	const res = await c.env.DB.prepare("UPDATE conversations SET title = ?, title_set = 1 WHERE id = ?").bind(clean, id).run();
	if (!res.meta.changes) return c.json({ error: "Conversation not found." }, 404);
	return c.json({ id, title: clean });
});

conversations.delete("/:id", async (c) => {
	const id = c.req.param("id");
	if (!CONVERSATION_ID.test(id)) return c.json({ error: "Conversation not found." }, 404);
	const agent = await getAgentByName(c.env.ChatAgent, id);
	await agent.deleteConversation();
	await c.env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run();
	return c.body(null, 204);
});
