#!/usr/bin/env bash
#
# Pushes the current upstream `main` into every site deployed from the Deploy to Cloudflare
# button. Each push triggers that owner's Workers Build, so their site updates by itself.
#
# WHY THIS EXISTS
# The button does NOT fork this repository. It squashes the whole history into a single
# commit ("source repo import", authored by cloudflare[bot]) and pushes that into a brand
# new repo in the deployer's account. There is therefore no fork link, no "Sync fork"
# button, and no shared history — `git merge-base` returns nothing, and a plain `git pull`
# refuses with "unrelated histories". The owner cannot update their own site by any route
# that does not involve a developer. This script is that developer.
#
# ACCESS
# Each owner adds you as a collaborator on their repo, once:
#   their repo -> Settings -> Collaborators -> Add people
# Understand what they are granting: their Worker auto-deploys whatever reaches `main`, and
# that Worker holds their D1 and KV bindings. Push access is therefore effectively access
# to their photographs. Do not ask for it casually, and do not keep it longer than needed.
#
# THE ONE FILE THAT MUST NOT TRAVEL
# Cloudflare rewrites `wrangler.json` in each copy with THAT owner's provisioned resource
# ids. Overwriting it from upstream repoints their site at your database and your image
# store — the site still loads, showing your gallery. The checkout below restores it.
#
# COROLLARY, AND IT IS LOAD-BEARING: never change `wrangler.json` upstream. It is the one
# file that legitimately differs per copy, so any commit touching it turns every update
# into a manual merge, once per owner.
#
# Usage:  bash scripts/push-update.sh          # push to every copy
#         DRY_RUN=1 bash scripts/push-update.sh  # show what would change, push nothing

set -euo pipefail

UPSTREAM="https://github.com/blessque/images-only.git"
WORKDIR="${WORKDIR:-.copies}"   # gitignored scratch space for the clones

# Add one line per deployed site. Keep it current — it is the only record of who is running
# this, and the only way to reach everyone if the auth path ever needs a patch.
COPIES=(
  # https://github.com/someone/their-site.git
)

if [ ${#COPIES[@]} -eq 0 ]; then
  echo "No copies listed. Add their repository URLs to COPIES in $0." >&2
  exit 1
fi

mkdir -p "$WORKDIR"

for url in "${COPIES[@]}"; do
  name=$(basename "$url" .git)
  dir="$WORKDIR/$name"

  [ -d "$dir" ] || git clone -q "$url" "$dir"
  git -C "$dir" remote get-url upstream >/dev/null 2>&1 || git -C "$dir" remote add upstream "$UPSTREAM"

  # Start from exactly what is published, not from whatever this clone was left in.
  git -C "$dir" fetch -q origin
  git -C "$dir" reset -q --hard origin/main
  git -C "$dir" fetch -q upstream

  git -C "$dir" checkout -q upstream/main -- .
  git -C "$dir" checkout -q HEAD -- wrangler.json

  if git -C "$dir" diff --cached --quiet; then
    echo "$name: already current"
    continue
  fi

  # Anything here other than files you changed upstream means THEY edited their copy, and
  # this script is about to revert it. Stop and look rather than pushing over someone's work.
  echo "$name:"
  git -C "$dir" diff --cached --stat | sed 's/^/  /'

  if [ -n "${DRY_RUN:-}" ]; then
    git -C "$dir" reset -q --hard origin/main
    continue
  fi

  git -C "$dir" commit -q -am "Update from upstream"
  git -C "$dir" push -q
  echo "  pushed — their build starts now, live in ~3 minutes"
done

# KNOWN LIMITATION: `checkout upstream/main -- .` adds and updates files but never DELETES
# them. If you remove a file upstream it will linger in every copy. Handle that by hand the
# day it happens; it has not happened yet.
