-- Step 2: uploaded bank statements and the transactions extracted from them.
-- Amounts are stored as REAL in the statement currency; negative = money out.

CREATE TABLE statements (
	id TEXT PRIMARY KEY,                -- uuid, also the Workflow instance id
	r2_key TEXT NOT NULL,               -- statements/{id}.pdf
	filename TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	page_count INTEGER,
	bank TEXT,
	account_iban_or_name TEXT,
	currency TEXT,
	period_start TEXT,                  -- ISO date
	period_end TEXT,                    -- ISO date
	opening_balance REAL,
	closing_balance REAL,
	status TEXT NOT NULL DEFAULT 'uploaded'
		CHECK (status IN ('uploaded', 'processing', 'done', 'failed')),
	error TEXT,                         -- set when status = 'failed'
	warning TEXT,                       -- e.g. balances don't reconcile
	extraction_method TEXT,             -- 'text' or 'vision'
	transaction_count INTEGER,          -- extracted, before dedupe
	inserted_count INTEGER,             -- actually inserted (not duplicates)
	uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	processed_at TEXT
);

CREATE INDEX statements_uploaded_at ON statements (uploaded_at DESC);

CREATE TABLE transactions (
	id TEXT PRIMARY KEY,
	statement_id TEXT NOT NULL REFERENCES statements (id) ON DELETE CASCADE,
	date TEXT NOT NULL,                 -- ISO date
	description TEXT NOT NULL,          -- as printed on the statement
	merchant TEXT,                      -- cleaned counterparty name
	amount REAL NOT NULL,               -- signed; negative = money out
	currency TEXT NOT NULL,
	category TEXT NOT NULL,
	category_source TEXT NOT NULL DEFAULT 'ai' CHECK (category_source IN ('ai', 'user')),
	is_recurring INTEGER NOT NULL DEFAULT 0,
	dedupe_hash TEXT NOT NULL UNIQUE,   -- account + date + amount + description (+ occurrence)
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX transactions_statement ON transactions (statement_id);
CREATE INDEX transactions_date ON transactions (date);
CREATE INDEX transactions_category ON transactions (category, date);
