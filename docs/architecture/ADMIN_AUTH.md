# Admin & Auth

## Threat model

One user, one password, a public site with no other accounts and no personal data. The
realistic threats are narrow but real:

- **Someone uploads junk to his portfolio.** The whole point of the gate.
- **Brute force.** One password, a public endpoint, no lockout — trivially automated.
- **A secret leaking into the client bundle.** Anything shipped to the browser is public.
- **An unguarded write route.** The most likely real-world failure, because routes get added
  later by someone who assumed the router handled auth.

Out of scope: multi-user, roles, sessions across devices, account recovery.

---

## The flow

```
Option+\  (or the grey lock in the footer)
  → password field appears, with validation
  → POST /api/login  { password }
  → Worker: rate-limit check → PBKDF2 hash → constant-time compare
  → returns a short-lived signed token (~2h)
  → token held in a JS variable
  → admin UI dynamically imported and mounted
  → reload ⇒ variable gone ⇒ admin off
```

## Non-negotiables

### The password is never checked on the client

A hardcoded password — **or its hash** — in the bundle is readable by anyone who opens
devtools. Hashing it client-side does not help: the hash becomes the password.

The Worker is the gate. Hiding the admin UI is cosmetic, and should be understood as a
convenience for him rather than a security control.

### The token lives in a JS variable, never `localStorage`

Not a compromise between security and the user's "admin mode is off on reload" requirement —
it is a single choice that satisfies both. `localStorage` would persist the token to disk
where any XSS could read it, *and* violate the requirement. The plain variable is both the
secure answer and the requested behaviour.

Corollary: no `Remember me`. It would require persisting the token, which is exactly what
we are avoiding.

### Rate limiting ships with the login endpoint

A single password with unlimited attempts is brute-forceable in an afternoon. This is not a
polish item to defer — **ship it with the endpoint or do not ship the endpoint.**

Progressive backoff keyed on IP, with a hard ceiling per window. Cloudflare gives the
primitives; a Durable Object counter or KV with a TTL both work.

### Every write endpoint verifies the token independently

Not "the router checks it" — **each route checks it, and each route has a test proving a
forged or expired token is rejected.**

The reasoning is about failure modes over time, not about today's code. Centralised auth is
correct right up until someone adds a route outside the guarded group, which is a silent,
invisible failure. A per-route test makes the omission fail loudly the moment it happens.

### Constant-time comparison

Hash comparison uses a constant-time routine. Timing attacks on a remote endpoint are
marginal in practice, but the correct primitive costs nothing and the wrong one is a
permanent footnote.

---

## Where the credentials live

Two sources, database first, resolved in `worker/credentials.ts`:

| Source | When | Notes |
|---|---|---|
| `auth` table in D1 | a site claimed through `/api/setup` | the normal path |
| `ADMIN_PASSWORD_HASH` + `TOKEN_SECRET` Worker secrets | set by hand | still works, still wins if the table is empty |

Neither present means the site is **unclaimed**, which is a real state a fresh deployment
starts in — not an error.

### Why they moved out of the secret store

The owner is a non-technical designer. Setting `ADMIN_PASSWORD_HASH` meant producing a
PBKDF2 hash, installing Node to do it, and getting a `$`-delimited string past a shell that
expands `$` — which cost two hours in one evening and is not a thing he can do at all. The
"thirty seconds in the dashboard" recovery story below assumed a technical operator, and the
moment the operator becomes the owner, that assumption inverts.

**Trade-off, taken deliberately:** the hash and token secret are now readable by anyone with
D1 access, where before they needed the secret store. The blast radius is the same in
practice — account access was already game over — and a PBKDF2 hash is built to survive
being read. The token secret genuinely is weaker for it, which is the price of the site
being claimable without a terminal.

It is a **separate table, not a `settings` row**: `readManifest` selects every settings row
and hand-picks `name` and `contact`. Nothing leaks today, but a credential one careless
refactor away from the public manifest is the wrong place to keep it.

### The claim, and the race it opens

An unclaimed site will hand admin to whoever asks first. `SETUP_CODE` — one word the owner
invents when deploying, prompted for by the Deploy to Cloudflare button — gates that one
request. It is not a password: it is used once, it is compared in constant time, and it is
inert the moment the site is claimed. `CHECK (id = 1)` on the `auth` table makes "claimed
once" a database invariant, so two simultaneous claims cannot both win regardless of the
handler.

A deployment with no `SETUP_CODE` is claimable by the first arrival. That is deliberate for
local and manual installs; the button-driven path always sets one.

Local dev reads them from `.dev.vars`, which is **gitignored** — and additionally denied to
Claude in `.claude/settings.json`, so they cannot be read into a transcript.

PBKDF2 via Web Crypto is used rather than bcrypt/Argon2 because it is **native to the
Workers runtime**. bcrypt would mean a WASM dependency at the edge for a single-user login;
PBKDF2 with a high iteration count is the right trade here.

**The iteration count is capped at 100,000 by the runtime, not chosen.** Above it,
`deriveBits` throws `NotSupportedError` and the login endpoint 1101s at the edge — and
neither the unit tests nor `wrangler dev` reproduce that, so it appears only in production.
Do not raise it toward OWASP's 600,000; see TUNING_LOG. Note also that the count lives
inside each stored hash, so changing it requires regenerating and re-uploading the secret.

## Password reset is deliberately unbuilt

The user asked whether email reset was overengineering. **It is, and the reasoning is worth
keeping:** building account recovery adds an entire attack surface — a mail provider, reset
tokens, expiry windows, an enumeration endpoint — to a single-user site, in order to save
one dashboard visit.

**Forgotten password = delete the `auth` row and claim the site again.** In the Cloudflare
dashboard: D1 → `justimages` → Console → `DELETE FROM auth;` → reload the site and set a new
password. Clicking, not a terminal — which is the whole point, since the person who forgets
the password is the person who cannot use `wrangler`.

(Where credentials come from Worker secrets instead, it remains
`wrangler secret put ADMIN_PASSWORD_HASH`.)

Building email reset would add a mail provider, reset tokens, expiry windows and an
enumeration endpoint to a single-user site, to save one dashboard visit. Do not.

---

## Admin behaviour

### Auto-save with undo, not a Save button

Every action saves immediately and raises an undo toast. Deletes are **soft** (`deleted_at`,
purged after 30 days).

For a non-technical user this is strictly better than an explicit save: he never wonders
whether his work persisted, and he never loses it to a misclick. The undo toast plus soft
delete makes the destructive path recoverable, which is what a Save button was really
protecting against.

### Reordering

`sort_order` integers, renumbered on save. At 200 items, fractional indexing is premature —
renumbering is a single cheap statement and far easier to reason about.

- **Arrow icons on each tile, and arrow keys.** Both, per the user. Icons are discoverable;
  keys are fast once known.
- **Drag-to-reorder lands last** and is the expensive piece: a justified grid re-solves under
  the dragged item, so the drop target moves while you drag it. It needs a stable insertion
  indicator computed against the pre-drag layout, not the live one.

### Alt text

**Prefilled from a cleaned-up filename, editable.** He will not hand-write 200 alt texts, and
empty alt on images that *are* the content is a real accessibility and SEO loss. A decent
default he can improve beats both a required field he will resent and an empty one he will
never fill.

### Editable footer settings

The footer's name and contact field are D1 settings rows, edited in admin mode like any
other content. They are the only text on the site.
