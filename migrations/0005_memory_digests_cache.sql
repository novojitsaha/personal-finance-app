-- Step 4c: chat memory (highlights), monthly digests and the tool-result cache.

-- A counter that goes up whenever the financial data changes (upload, delete,
-- category change, merchant rename/merge/split, recurring, budgets, flags).
-- Cached tool results and digests are only used for the current version.
CREATE TABLE app_meta (
	key TEXT PRIMARY KEY,
	value INTEGER NOT NULL
);
INSERT INTO app_meta (key, value) VALUES ('data_version', 1);

-- Short notes the chat saves automatically from conversations: goals,
-- facts, preferences and explanations. New chats start with them.
CREATE TABLE memories (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	-- goal | fact | preference | note
	kind TEXT NOT NULL DEFAULT 'note',
	text TEXT NOT NULL,
	-- 'ai' (saved from a chat) or 'user' (added or edited on the Memory page)
	source TEXT NOT NULL DEFAULT 'ai',
	conversation_id TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX memories_updated ON memories (updated_at);

-- AI-written summary per month, regenerated when the data changes.
CREATE TABLE digests (
	month TEXT PRIMARY KEY,
	data_version INTEGER NOT NULL,
	-- the computed facts the summary was written from (JSON)
	facts TEXT NOT NULL,
	-- the AI-written summary (markdown bullets)
	summary TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Tool results by tool + arguments, valid while data_version is unchanged.
CREATE TABLE tool_cache (
	key TEXT PRIMARY KEY,
	data_version INTEGER NOT NULL,
	result TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per tool call (chat or MCP), for cache hit rates on the AI usage page.
CREATE TABLE tool_calls (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	tool TEXT NOT NULL,
	-- chat | mcp
	source TEXT NOT NULL,
	cache_hit INTEGER NOT NULL,
	conversation_id TEXT
);
CREATE INDEX tool_calls_created ON tool_calls (created_at);
