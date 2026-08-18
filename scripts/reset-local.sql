-- Drops every table in the LOCAL development database, so `npm run local:reset`
-- can rebuild it from migrations/ alone.
--
-- This SQL lives in a file, not inline in a package.json script, and that is
-- load-bearing rather than tidiness: a `--command "…"` argument containing more
-- than one statement makes the Deploy to Cloudflare dashboard fail with
-- "There was a problem parsing the Wrangler configuration file" — an error about
-- a file that is perfectly fine. Bisected over 20 probe repositories on
-- 2026-08-19; see docs/decisions/TUNING_LOG.md.
--
-- Run with `d1 execute --file`, which iteration 9's rule forbids for MIGRATIONS
-- and only for migrations: the danger there is a transform that silently runs
-- twice. A teardown is meant to be re-runnable, every statement is guarded with
-- IF EXISTS, and running it twice is a no-op. Do not generalise this into
-- applying migrations by hand.

DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS d1_migrations;
