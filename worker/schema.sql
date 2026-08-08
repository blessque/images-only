-- D1 schema. Apply with:
--   npx wrangler d1 execute justimages --file worker/schema.sql            (local)
--   npx wrangler d1 execute justimages --file worker/schema.sql --remote   (production)

CREATE TABLE IF NOT EXISTS images (
  id           TEXT PRIMARY KEY,
  -- w/h as a float. The ONLY thing layout needs; storing width and height instead
  -- invites someone to recompute this inconsistently somewhere else.
  aspect       REAL    NOT NULL,
  size_class   TEXT    NOT NULL CHECK (size_class IN ('big', 'medium', 'small')),
  alt          TEXT    NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  -- Soft delete: a non-technical user must not lose work to a misclick. Purged after 30
  -- days by a maintenance sweep, not on delete.
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
