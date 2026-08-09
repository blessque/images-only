-- Small sources are uploaded UNTOUCHED — one object, no ladder, no re-encode. Two facts
-- have to travel with the row: that it happened, and what extension the bytes live under.
--
-- Additive and therefore genuinely idempotent-safe in shape — but it is still applied
-- through `wrangler d1 migrations apply`, which records it and refuses to repeat it.
-- 0001 is the standing reminder of why: see its header.

ALTER TABLE images ADD COLUMN passthrough INTEGER NOT NULL DEFAULT 0;
ALTER TABLE images ADD COLUMN format TEXT NOT NULL DEFAULT 'webp';
