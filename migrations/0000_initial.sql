-- The baseline schema, as it stood before 0001.
--
-- This exists because migrations must be able to build a database FROM NOTHING. Until now
-- the schema lived in `worker/schema.sql` and the migrations only transformed it, so a
-- fresh database — production, on its first deploy — had no `images` table for 0001 to
-- rebuild, and the whole chain failed on `no such table: images`.
--
-- Two sources of truth for one schema is the actual defect. `worker/schema.sql` is gone;
-- `migrations/` is now the only definition, and every database (local or production)
-- reaches the current shape by the same path.
--
-- Deliberately reproduces the OLD column names — `big`/`medium`/`small`, no passthrough.
-- 0001-0003 then rename and extend exactly as they did historically. Replaying history
-- costs a couple of table rebuilds on an empty database, once, and buys a single code path.
--
-- `IF NOT EXISTS` throughout so it is a harmless no-op on databases that predate it.

CREATE TABLE IF NOT EXISTS images (
  id           TEXT PRIMARY KEY,
  -- w/h as a float. The ONLY thing layout needs; storing width and height instead
  -- invites someone to recompute this inconsistently somewhere else.
  aspect       REAL    NOT NULL,
  size_class   TEXT    NOT NULL CHECK (size_class IN ('big', 'medium', 'small')),
  alt          TEXT    NOT NULL DEFAULT '',
  -- The largest variant that actually EXISTS in R2. The encoder never upscales, so a
  -- 1024px source has no 1600 or 2400 rung — and srcset must not advertise one.
  max_rung     INTEGER NOT NULL DEFAULT 2400,
  sort_order   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  -- Soft delete: a non-technical user must not lose work to a misclick.
  deleted_at   INTEGER
);

-- The manifest query is exactly "live images in order", so index that and nothing else.
CREATE INDEX IF NOT EXISTS images_live_order
  ON images (sort_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('name', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('contact', '');

CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  attempts     INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
