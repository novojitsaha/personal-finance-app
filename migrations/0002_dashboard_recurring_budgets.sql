-- Step 3: dashboard, category overrides, recurring rules, budgets, flags, and
-- statement <-> transaction links. Additive only, safe for existing data.

-- Normalized counterparty, used to group transactions by merchant. A virtual
-- generated column, so existing rows need no backfill.
ALTER TABLE transactions ADD COLUMN merchant_key TEXT
	GENERATED ALWAYS AS (lower(trim(coalesce(nullif(merchant, ''), description)))) VIRTUAL;
CREATE INDEX transactions_merchant_key ON transactions (merchant_key, date);

-- Which statements contain each transaction. A transaction is stored once
-- (dedupe_hash) but can appear in several overlapping statements; it is only
-- deleted when no remaining statement contains it.
CREATE TABLE statement_transactions (
	statement_id TEXT NOT NULL REFERENCES statements (id) ON DELETE CASCADE,
	transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
	PRIMARY KEY (statement_id, transaction_id)
);
CREATE INDEX statement_transactions_tx ON statement_transactions (transaction_id);
INSERT OR IGNORE INTO statement_transactions (statement_id, transaction_id)
	SELECT statement_id, id FROM transactions;

-- "Always use this category for this merchant": applied to existing
-- transactions when set, and to new uploads before AI categorization.
CREATE TABLE merchant_overrides (
	merchant_key TEXT PRIMARY KEY,
	merchant TEXT NOT NULL,
	category TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Monthly recurring payments the user confirmed. Matching happens at read
-- time (src/worker/lib/analytics.ts): a money-out transaction from the same
-- merchant_key matches when its amount is within the tolerance of the rule's
-- amount or of the previous matched charge, so gradual price changes are
-- followed and new uploads are covered automatically.
CREATE TABLE recurring_rules (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	merchant_key TEXT NOT NULL,
	merchant TEXT NOT NULL,
	amount REAL NOT NULL CHECK (amount > 0),   -- typical charge, positive
	tolerance REAL NOT NULL DEFAULT 0.1,
	category TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX recurring_rules_merchant ON recurring_rules (merchant_key);

-- Recurring suggestions the user dismissed ("not a subscription").
CREATE TABLE dismissed_recurring_suggestions (
	merchant_key TEXT PRIMARY KEY,
	dismissed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Monthly budget per category; category '*' is the overall budget.
CREATE TABLE budgets (
	category TEXT PRIMARY KEY,
	amount REAL NOT NULL CHECK (amount > 0),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Unusual-charge flags the user dismissed. Flags themselves are computed on
-- the fly from the transactions; a dismissal hides one (transaction, reason).
CREATE TABLE flag_dismissals (
	transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
	code TEXT NOT NULL,
	dismissed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	PRIMARY KEY (transaction_id, code)
);

-- Merchant renames and merges: transactions whose merchant_key is alias_key
-- are shown and analysed as canonical_key / canonical_name. Applied at read
-- time, so it also covers future uploads.
CREATE TABLE merchant_aliases (
	alias_key TEXT PRIMARY KEY,
	canonical_key TEXT NOT NULL,
	canonical_name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX merchant_aliases_canonical ON merchant_aliases (canonical_key);

-- Name variants split off from a merchant: transactions whose description
-- pattern (lowercase, digits and punctuation removed; see variantKey() in
-- src/worker/lib/merchants.ts) equals variant_key are treated as merchant_name
-- before aliases apply. Remembered for future uploads.
CREATE TABLE merchant_variant_rules (
	variant_key TEXT PRIMARY KEY,
	merchant_name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
