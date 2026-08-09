# Handover

For the person handing this site to its owner. Read once, do once, then you are done.

The goal is not "he can reach me quickly". It is **he never has to.** Every step below
exists to remove a dependency on you: your GitHub account, your Cloudflare account, your
laptop, your memory of how this works.

---

## What he ends up owning

| | Whose | How he gets it |
|---|---|---|
| The Cloudflare account | his | he creates it, with his own email |
| The Worker, D1, KV | his | created inside his account by the deploy button |
| The GitHub repository | his | the deploy button forks it there |
| The domain | his | bought in his name, on his card |
| The photographs | his | already his — **Download everything** in admin |
| The password | his | he chooses it, in a browser, and you never learn it |

**You should end up holding nothing.** If you still hold something at the end, the handover
is not finished.

---

## The transfer

### 1. He creates a Cloudflare account

His email, his password. Free, and **no card is required** — the site runs on Workers KV
precisely so that stays true.

### 2. He deploys it

From the repository's README, the **Deploy to Cloudflare** button. It copies the repository
into his GitHub, creates his KV namespace and D1 database, applies the migrations, and asks
him to invent a **setup code** — one word, typed once.

You can sit next to him for this. He does not need you to do it.

### 3. He claims the site

He opens the URL and it asks him to choose a password. He types it, and he is in.

**Do not choose it for him and do not write it down for him.** The point of the claim flow is
that the password exists only in his head from the first second. Tell him plainly: it cannot
be recovered, only replaced, and the replacement steps are in the Help page.

### 4. He adds his photographs

Drag and drop. Nothing else.

> **Do not run `npm run import` from an old export.** The `export/` folder in this working
> copy is a test gallery — stock photographs, AI-generated images, placeholder alt text and a
> real phone number in the settings. Importing it would publish all of that. His real work
> goes in by hand, once, and it is not a large job.

### 5. He sets the footer

Name and contact are editable in place in admin mode. They are the only text on the site.

### 6. He takes a backup, himself, in front of you

**Download everything** in the admin bar. Watch him do it and watch it land in his Downloads
folder. This is the step people skip, and it is the one that makes the rest of it true —
until he has done it once, "his photographs are his" is a claim rather than a fact.

### 7. A domain, if he wants one

Buy it in his name — reg.ru or Timeweb accept Russian cards; Cloudflare Registrar likely
will not. Then `docs/RUNBOOK.md` has the steps for pointing it at the site.

Until then the `*.workers.dev` address works fine. Note it is chosen **once per account** and
changing it later breaks every link he has shared.

---

## Then hand him three things

1. **The Help page** — `https://his-site/help`, also linked in the admin bar. Tell him to
   bookmark it. It is written for him, not for a developer.
2. **`docs/RUNBOOK.md`** — for whoever helps him one day. That may not be you.
3. **This sentence:** *"If this ever breaks and I am not around, give a developer the
   repository link and `docs/RUNBOOK.md`."*

---

## What to tell him honestly

- **The free tier is genuinely free.** No card, no trial, no expiry. Roughly 600
  photographs of storage, about 250 uploads a day.
- **Video does not work here** and is not a small addition. GIFs under about 150KB are fine;
  larger ones lose their animation.
- **If he forgets the password**, the Help page has the four clicks that replace it. He does
  not need a terminal and he does not need you.
- **If Cloudflare becomes unreachable** — a real possibility for a Russian audience — there
  are two tested ways out, both in the runbook: `npm run freeze` to plain files, or the Node
  port. Neither loses a photograph.

---

## Finishing

- [ ] The site is in **his** Cloudflare account, not yours
- [ ] The repository is in **his** GitHub account
- [ ] He chose the password and you do not know it
- [ ] He has downloaded a backup himself, at least once
- [ ] He has the Help page bookmarked
- [ ] You have deleted the placeholder Worker, D1 and KV from **your** account
- [ ] You hold nothing that the site depends on

The last two matter. A handover that leaves your account in the dependency chain is a
handover that reverses itself the first time you change something.
