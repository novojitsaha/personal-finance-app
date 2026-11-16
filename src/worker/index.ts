import { Hono } from "hono";
import { statements } from "./routes/statements";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/statements", statements);

app.onError((err, c) => {
	console.error(err);
	return c.json({ error: "Internal error." }, 500);
});

export { StatementWorkflow } from "./workflow";
export default app;
