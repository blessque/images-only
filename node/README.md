# Running justimages without Cloudflare

The same site, on an ordinary server: Node, SQLite, and a folder of files. No edge, no
account, no vendor.

**`src/` and `worker/` are not modified to make this work.** The Worker is a standard
`fetch(request, env)` handler; everything here is the env it expects and a socket to read
from. That is the whole cost of the exit, and it was kept small on purpose.

---

## Read this before you choose it

**This is not a simpler option than Cloudflare. It is a harder one.**

Cloudflare free has no server to patch, no certificate to renew, and nothing that can die at
3am. A VPS has all three, and they become somebody's job forever. If nobody is going to be
that somebody, the honest alternative is not this — it is `npm run freeze`, which turns the
gallery into plain files that any host serves and nobody maintains.

Pick this pathway for one specific reason: **your visitors cannot reach Cloudflare reliably**
and you need the site on infrastructure they can. Cost is not the reason — Cloudflare free
is free, and needs no card.

---

## What it costs

| | ~/month | Notes |
|---|---|---|
| Beget VPS | from 210₽ | Russian cards, RU/KZ/EU locations |
| Timeweb Cloud | from ~180₽ | hourly billing available |
| Domain (reg.ru, Timeweb) | ~200–800₽/year | needed for HTTPS |

1 CPU and 1GB RAM is plenty. The site serves files and runs one SQLite database.

---

## Running it

Needs **Node 22.5 or newer** — SQLite is built into Node from that version, so there is no
database to install and no native module to compile.

```bash
git clone <your repo> && cd justimages
npm install
npm run node:start
```

That builds the client, bundles the Worker, applies every pending migration, and serves on
`http://127.0.0.1:8080`. Then open it and choose your admin password, exactly as on
Cloudflare.

Configuration, all optional:

```bash
PORT=8080                 # default
HOST=127.0.0.1            # bind address; keep it local behind a reverse proxy
DATA_DIR=/srv/justimages  # SQLite file + image bytes. THIS is what you back up.
SETUP_CODE=one-word       # gates the first claim, if the URL is public before you claim it
```

### Keeping it running

```ini
# /etc/systemd/system/justimages.service
[Unit]
Description=justimages
After=network.target

[Service]
WorkingDirectory=/srv/justimages/app
Environment=DATA_DIR=/srv/justimages/data
Environment=PORT=8080
ExecStart=/usr/bin/node node/server.mjs
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now justimages
```

### HTTPS and your domain

[Caddy](https://caddyserver.com) gets certificates on its own and renews them, which is one
fewer thing to forget:

```
your-domain.ru {
    reverse_proxy 127.0.0.1:8080
}
```

Point an `A` record at the server's IP first. Caddy does the rest on first request.

---

## Moving the photographs in

The gallery travels over the public API, so it does not care what is behind it:

```bash
npm run export -- https://your-old-site        # from Cloudflare
IMPORT_PASSWORD='…' npm run import -- https://your-new-site
```

Verified byte-identical across the move: 16 photographs out of Workers KV and into the
filesystem backend with no change to a single file in `src/`.

---

## Backups

Everything that matters is in `DATA_DIR`:

```
DATA_DIR/justimages.sqlite    the manifest, the settings, the admin password hash
DATA_DIR/images/{id}/*        the photographs
```

Copy that directory and you have the site. There is also a **Download everything** button in
the admin bar, which produces the same thing as a zip without touching the server.

---

## What is different from Cloudflare

- **No global edge.** One server, in one place. Visitors far from it wait longer.
- **You own uptime.** Reboots, disk space, and the day the process dies are yours.
- **No free tier ceilings.** No 1,000 writes a day, no 1GB — just the disk you rent.
- **R2 and KV are irrelevant.** `worker/storage.ts` falls through to the filesystem.

Verified end to end by `npm run verify:node`: migrations on boot, claiming from a browser,
byte-identical uploads, immutable cache headers, the manifest inlined into the shell, and a
forged token rejected by every write route.
