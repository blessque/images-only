-- Admin credentials move from Worker secrets into the database, so the site can be claimed
-- from a browser instead of a terminal.
--
-- WHY: the owner is a non-technical designer. Setting `ADMIN_PASSWORD_HASH` required
-- producing a PBKDF2 hash and getting it past zsh intact, which is not a thing he can do —
-- and `wrangler secret put` is not a thing he should have to install Node for. The site now
-- ships unclaimed and asks for a password on first visit. See ADMIN_AUTH.md.
--
-- NOT stored in `settings`: `readManifest` does `SELECT key, value FROM settings` and picks
-- out `name` and `contact` by hand. Nothing leaks today, but a credential one careless
-- refactor away from the public manifest is the wrong place to keep it. A separate table
-- makes that structural rather than a whitelist someone has to keep correct.
--
-- `CHECK (id = 1)` makes "claimed exactly once" a database invariant instead of application
-- logic — a second claim cannot be written even if a request races past the handler's check.

CREATE TABLE IF NOT EXISTS auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT    NOT NULL,
  token_secret  TEXT    NOT NULL,
  claimed_at    INTEGER NOT NULL
);
