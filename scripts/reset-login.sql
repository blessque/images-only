-- Clears the rate limiter so the verification suites can log in repeatedly.
--
-- One statement, so it never tripped the deploy-dashboard bug that
-- scripts/reset-local.sql documents — but it lives in a file for the same
-- reason anyway: the moment somebody appends a second statement to an inline
-- `--command "…"`, the deploy button breaks and blames the Wrangler config.
-- Keeping both resets in files means that edit cannot happen.

DELETE FROM login_attempts;
