-- ============================================================
-- Fredy — D1 Analytics Schema (Phase 7+ — optional)
-- ============================================================
-- This migration creates the analytics tables. It is NOT applied
-- automatically in the scaffold phase. Apply with:
--   wrangler d1 execute fredy-analytics --file=migrations/0001_init.sql
-- ============================================================

-- Published posts log
CREATE TABLE IF NOT EXISTS posts (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  source        TEXT NOT NULL,
  language      TEXT NOT NULL,
  quality_score INTEGER NOT NULL,
  ai_provider   TEXT NOT NULL,
  ai_model      TEXT NOT NULL,
  telegram_chat_id   TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  text_preview  TEXT,
  published_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category     ON posts(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_source       ON posts(source, published_at DESC);

-- Source fetch log
CREATE TABLE IF NOT EXISTS source_fetches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  item_count  INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  success     INTEGER NOT NULL,
  error       TEXT,
  fetched_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_fetches_source ON source_fetches(source, fetched_at DESC);

-- AI call log
CREATE TABLE IF NOT EXISTS ai_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_length  INTEGER NOT NULL,
  output_length INTEGER NOT NULL,
  latency_ms    INTEGER NOT NULL,
  success       INTEGER NOT NULL,
  error         TEXT,
  called_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_calls_provider ON ai_calls(provider, called_at DESC);

-- Admin action log
CREATE TABLE IF NOT EXISTS admin_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER NOT NULL,
  action      TEXT NOT NULL,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  performed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_id, performed_at DESC);
