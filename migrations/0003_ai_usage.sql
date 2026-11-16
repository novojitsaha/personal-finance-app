-- Step 4a: one row per Workers AI call (statement extraction, categorization,
-- chat, summaries, highlights), for the AI Usage page. Rows are kept when a
-- statement or conversation is deleted, so past costs stay accurate.
CREATE TABLE ai_usage (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	-- extraction | categorization | chat | summary | highlights | digest
	feature TEXT NOT NULL,
	-- finer-grained step, e.g. header, chunk, transcribe, categorize, chat
	task TEXT NOT NULL,
	model TEXT NOT NULL,
	input_tokens INTEGER NOT NULL DEFAULT 0,
	cached_input_tokens INTEGER NOT NULL DEFAULT 0,
	output_tokens INTEGER NOT NULL DEFAULT 0,
	cost_usd REAL NOT NULL DEFAULT 0,
	-- false when the call failed or its answer was rejected (it still costs)
	ok INTEGER NOT NULL DEFAULT 1,
	statement_id TEXT,
	conversation_id TEXT,
	-- the user message a chat call answers (one question can take several calls)
	message_id TEXT
);
CREATE INDEX ai_usage_created ON ai_usage (created_at);
CREATE INDEX ai_usage_statement ON ai_usage (statement_id);
CREATE INDEX ai_usage_conversation ON ai_usage (conversation_id);
