-- The MySQL shape of migrations/*.sql, as it stands after 0004.
--
-- Shared hosting offers MySQL and not SQLite (confirmed with Handyhost, 2026-08-20), so this
-- is a translation rather than a copy. It is applied ONCE by install.php against an empty
-- database — there is no migration chain here, because a PHP install starts at the current
-- schema and has no history to replay. `migrations/` remains the only definition for D1.
--
-- Four deliberate differences from the D1 original, each forced by MySQL:
--
--   1. `key` and `value` are reserved words, so `settings` uses `setting_key`/`setting_value`
--      and `login_attempts` uses `client_key`. Column names never travel — export/import
--      speaks HTTP only — so the divergence is invisible outside this file.
--   2. CHECK constraints are silently IGNORED on MySQL 5.7. Enforcement therefore rides on
--      things 5.7 does honour: an ENUM for size_class, and a PRIMARY KEY for the auth row.
--   3. No partial indexes. `images_live_order` indexes both columns instead of filtering.
--   4. utf8mb4 throughout — alt text is Cyrillic here, and utf8 in MySQL is not UTF-8.

CREATE TABLE IF NOT EXISTS images (
  id           VARCHAR(16)  NOT NULL PRIMARY KEY,
  -- w/h as a float. The ONLY thing layout needs; storing width and height instead
  -- invites someone to recompute this inconsistently somewhere else.
  aspect       DOUBLE       NOT NULL,
  -- ENUM, not CHECK: 5.7 ignores CHECK and would accept any string. The three values are
  -- the same set VALID_CLASSES guards in worker/index.ts.
  size_class   ENUM('solo', 'wide', 'tight') NOT NULL,
  alt          VARCHAR(500) NOT NULL DEFAULT '',
  -- The largest variant that actually EXISTS on disk. The encoder never upscales, so a
  -- 1024px source has no 1600 or 2400 rung — and srcset must not advertise one.
  max_rung     INT          NOT NULL DEFAULT 2400,
  passthrough  TINYINT      NOT NULL DEFAULT 0,
  format       VARCHAR(8)   NOT NULL DEFAULT 'webp',
  sort_order   INT          NOT NULL,
  created_at   BIGINT       NOT NULL,
  -- Soft delete: a non-technical user must not lose work to a misclick.
  deleted_at   BIGINT       NULL,
  -- D1 filters this index with `WHERE deleted_at IS NULL`; MySQL has no partial index, so
  -- deleted_at leads and the planner gets the same "live images in order" access path.
  KEY images_live_order (deleted_at, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
  setting_value VARCHAR(200) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('name', ''), ('contact', '');

CREATE TABLE IF NOT EXISTS login_attempts (
  client_key   VARCHAR(64) NOT NULL PRIMARY KEY,
  attempts     INT         NOT NULL,
  window_start BIGINT      NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row, forever. D1 spells that `CHECK (id = 1)`; here the PRIMARY KEY does the same job
-- on every MySQL version, because every insert hardcodes id = 1 and the second one fails as
-- a duplicate key. "Claimed exactly once" stays a database invariant rather than a race the
-- handler has to win. See docs/architecture/ADMIN_AUTH.md.
CREATE TABLE IF NOT EXISTS auth (
  id            TINYINT      NOT NULL PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  token_secret  VARCHAR(255) NOT NULL,
  claimed_at    BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
