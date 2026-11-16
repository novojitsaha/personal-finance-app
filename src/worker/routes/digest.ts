// GET /api/digest?month=YYYY-MM: the month's AI summary. If it is missing or
// its facts changed, a new one is generated in the background (the response
// says so) and the client asks again shortly.
import { Hono } from "hono";
import { getDigest, refreshDigests } from "../lib/digest";

type Env = { Bindings: Cloudflare.Env };
export const digest = new Hono<Env>();

/** Avoid starting the same month twice while one generation is running. */
const LOCK_SECONDS = 90;

digest.get("/", async (c) => {
	const month = c.req.query("month") ?? "";
	if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: "month=YYYY-MM is required." }, 400);
	const db = c.env.DB;
	const current = await getDigest(db, month);
	let generating = false;
	if (!current || current.stale) {
		const now = Math.floor(Date.now() / 1000);
		const lock = await db
			.prepare(
				`INSERT INTO app_meta (key, value) VALUES (?1, ?2)
				 ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE app_meta.value < ?2 - ?3
				 RETURNING value`,
			)
			.bind(`digest_lock:${month}`, now, LOCK_SECONDS)
			.first();
		generating = true;
		if (lock) {
			c.executionCtx.waitUntil(
				refreshDigests({ ai: c.env.AI, db }, [month])
					.catch((err) => console.error("Digest generation failed", err))
					.finally(() => db.prepare("DELETE FROM app_meta WHERE key = ?").bind(`digest_lock:${month}`).run()),
			);
		}
	}
	return c.json({ digest: current, generating });
});
