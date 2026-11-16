// Memory notes the chat saved (or you added): list, add, edit, delete.
import { Hono } from "hono";
import type { Memory } from "../../shared/api";

type Env = { Bindings: Cloudflare.Env };
export const memories = new Hono<Env>();

const KINDS = ["goal", "fact", "preference", "note"] as const;
type Body = { kind?: string; text?: string };
const parse = async (req: { json: <T>() => Promise<T> }) => {
	const b = await req.json<Body>().catch(() => ({}) as Body);
	const text = (b.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
	const kind = KINDS.includes(b.kind as (typeof KINDS)[number]) ? b.kind! : "note";
	return { text, kind };
};

memories.get("/", async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT m.id, m.kind, m.text, m.source, m.conversation_id, c.title AS conversation_title, m.created_at, m.updated_at
		 FROM memories m LEFT JOIN conversations c ON c.id = m.conversation_id
		 ORDER BY CASE m.kind WHEN 'goal' THEN 0 WHEN 'preference' THEN 1 WHEN 'fact' THEN 2 ELSE 3 END, m.updated_at DESC`,
	).all<Memory>();
	return c.json(results);
});

memories.post("/", async (c) => {
	const { text, kind } = await parse(c.req);
	if (!text) return c.json({ error: "Text is required." }, 400);
	const row = await c.env.DB.prepare("INSERT INTO memories (kind, text, source) VALUES (?, ?, 'user') RETURNING id").bind(kind, text).first<{ id: number }>();
	return c.json({ id: row?.id }, 201);
});

memories.patch("/:id", async (c) => {
	const { text, kind } = await parse(c.req);
	if (!text) return c.json({ error: "Text is required." }, 400);
	const res = await c.env.DB.prepare(
		"UPDATE memories SET text = ?, kind = ?, source = 'user', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
	)
		.bind(text, kind, Number(c.req.param("id")))
		.run();
	if (!res.meta.changes) return c.json({ error: "Note not found." }, 404);
	return c.json({ ok: true });
});

memories.delete("/:id", async (c) => {
	await c.env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(Number(c.req.param("id"))).run();
	return c.body(null, 204);
});
