-- Renames the densest shared class: `medium` -> `tight`.
--
-- The UI shows full words now, and "tight" says what the class does (pack more per row)
-- where "medium" only implied a size it never controlled. Same reasoning that replaced
-- `big` with `solo` in 0001.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt.
--
-- Unlike 0001 this one IS idempotent in shape — `tight` does not match `medium`, so a
-- second pass is a no-op. It is still applied through `wrangler d1 migrations apply`,
-- which records it; 0001 is the standing reminder of why that matters.

CREATE TABLE images_tight (
  id           TEXT PRIMARY KEY,
  aspect       REAL    NOT NULL,
  size_class   TEXT    NOT NULL CHECK (size_class IN ('solo', 'wide', 'tight')),
  alt          TEXT    NOT NULL DEFAULT '',
  max_rung     INTEGER NOT NULL DEFAULT 2400,
  passthrough  INTEGER NOT NULL DEFAULT 0,
  format       TEXT    NOT NULL DEFAULT 'webp',
  sort_order   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

INSERT INTO images_tight (id, aspect, size_class, alt, max_rung, passthrough, format, sort_order, created_at, deleted_at)
SELECT
  id,
  aspect,
  CASE size_class WHEN 'medium' THEN 'tight' ELSE size_class END,
  alt,
  max_rung,
  passthrough,
  format,
  sort_order,
  created_at,
  deleted_at
FROM images;

DROP TABLE images;
ALTER TABLE images_tight RENAME TO images;

CREATE INDEX IF NOT EXISTS images_live_order
  ON images (sort_order) WHERE deleted_at IS NULL;
