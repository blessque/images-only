-- Renames the size classes, preserving every uploaded image and its R2 objects.
--
--   big -> solo    (it was already meant to take a whole row)
--   medium -> wide (roughly half a row, as before)
--   small -> medium (the densest remaining class)
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt. Run with:
--   npm run db:migrate
--
-- Nothing is deployed yet, so this exists purely to save re-uploading during local
-- testing. Once production exists, migrations become the only safe way to change schema.

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
