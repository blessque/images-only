-- D1 schema. Apply with:
--   npx wrangler d1 execute justimages --file worker/schema.sql            (local)
--   npx wrangler d1 execute justimages --file worker/schema.sql --remote   (production)

CREATE TABLE IF NOT EXISTS images (
  id           TEXT PRIMARY KEY,
  -- w/h as a float. The ONLY thing layout needs; storing width and height instead
  -- invites someone to recompute this inconsistently somewhere else.
  aspect       REAL    NOT NULL,
  -- solo = a whole row to itself, at any aspect ratio, exempt from the height clamp.
  -- wide / tight share rows and differ only in how much of one they ask for.
  size_class   TEXT    NOT NULL CHECK (size_class IN ('solo', 'wide', 'tight')),
  alt          TEXT    NOT NULL DEFAULT '',
  -- The largest variant that actually EXISTS in R2. The encoder never upscales, so a
  -- 1024px source has no 1600 or 2400 rung — and srcset must not advertise one, or the
  -- browser picks it, 404s, and the tile falls through to the broken-image mark.
  -- Emitted rungs are always a prefix of the ladder, so one number describes the set.
  max_rung     INTEGER NOT NULL DEFAULT 2400,
  -- 1 when the source was uploaded untouched: one object at {id}/full.{format}, no
  -- ladder, no re-encode. Chosen for files small enough that compressing them costs
  -- quality and buys nothing.
  passthrough  INTEGER NOT NULL DEFAULT 0,
  -- Extension the bytes are stored under. 'webp' for the ladder; the source's own format
  -- for a passthrough, because those bytes are never converted.
  format       TEXT    NOT NULL DEFAULT 'webp',
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
