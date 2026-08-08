-- Renames the size classes, preserving every uploaded image and its R2 objects.
--
--   big -> solo    (it was already meant to take a whole row)
--   medium -> wide (roughly half a row, as before)
--   small -> medium (the densest remaining class)
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt.
--
-- THIS FILE IS NOT IDEMPOTENT AND CANNOT BE MADE SO. `medium` is both an old name and a
-- new one, so the CASE cannot tell a migrated row from an unmigrated one: running it twice
-- pushes every `small`->`medium` row on to `wide`. That is exactly what happened once, and
-- it is unrecoverable because no column distinguishes the two groups afterwards.
--
-- It is therefore run through `wrangler d1 migrations apply`, which records what has been
-- applied in `d1_migrations` and refuses to repeat it. Never invoke a migration file with
-- `d1 execute --file` — that has no memory.

CREATE TABLE images_migrated (
  id           TEXT PRIMARY KEY,
  aspect       REAL    NOT NULL,
  size_class   TEXT    NOT NULL CHECK (size_class IN ('solo', 'wide', 'medium')),
  alt          TEXT    NOT NULL DEFAULT '',
  max_rung     INTEGER NOT NULL DEFAULT 2400,
  sort_order   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

INSERT INTO images_migrated (id, aspect, size_class, alt, max_rung, sort_order, created_at, deleted_at)
SELECT
  id,
  aspect,
  CASE size_class
    WHEN 'big'    THEN 'solo'
    WHEN 'medium' THEN 'wide'
    WHEN 'small'  THEN 'medium'
    ELSE size_class
  END,
  alt,
  max_rung,
  sort_order,
  created_at,
  deleted_at
FROM images;

DROP TABLE images;
ALTER TABLE images_migrated RENAME TO images;

CREATE INDEX IF NOT EXISTS images_live_order
  ON images (sort_order) WHERE deleted_at IS NULL;
