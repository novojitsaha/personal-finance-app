-- Step 4b: index of chat conversations. The messages themselves live in each
-- conversation's ChatAgent Durable Object (SQLite); this table lists them.
CREATE TABLE conversations (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL DEFAULT 'New chat',
	-- true once the user renamed it, so the title is no longer set automatically
	title_set INTEGER NOT NULL DEFAULT 0,
	message_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX conversations_updated ON conversations (updated_at);
