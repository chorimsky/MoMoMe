# Deploy workflow — Vercel (dev) → Hostinger (prod)

Two environments, one backend:

| Env | URL | Hosts | How it deploys |
|-----|-----|-------|----------------|
| **Dev / staging** | `mo-mo-me-app.vercel.app` | frontend | **automatic** on every `git push` to `main` |
| **Production (live)** | `momome.xyz` | frontend (Hostinger Cloud) | **manual** — `scripts/deploy-hostinger.sh` |
| Backend (both) | `momome-api-production.up.railway.app` | Node settlement engine | Railway (`railway up`) |

Both frontends call the **same Railway backend** — Vercel is for testing the UI,
not a separate backend.

## The loop

```
# 1. make changes, then push → Vercel builds automatically
git add -A && git commit -m "…" && git push

# 2. test on the Vercel URL (mo-mo-me-app.vercel.app)

# 3. happy? ship the same code to the live site — EITHER:
#    a) GitHub Actions → "Deploy to Hostinger (production)" → Run workflow   (no laptop needed)
#       or push a release tag:  git tag v1.2.3 && git push --tags
#    b) locally:
bash scripts/deploy-hostinger.sh
```

Both build (type-checked) and rsync the same `app/dist/` to `momome.xyz`. The
GitHub Action (`.github/workflows/deploy-hostinger.yml`) uses repo secrets
(`HOSTINGER_*` + `HOSTINGER_SSH_KEY`) — already configured.

`deploy-hostinger.sh` runs the full build (with type-check — a TS error aborts
the deploy), uploads `app/dist/` to Hostinger over the SSH deploy key, and
verifies the live bundle hash. Nothing goes live until you run it.

## Backend changes

If a change touches `server/`, redeploy Railway too (independent of the
frontend):
```
RAILWAY_API_TOKEN=… railway up --ci --service momome-api
```

## Notes
- **API base:** the Vercel build points at the Railway URL via `vercel.json`;
  the Hostinger build defaults to the same. When `api.momome.xyz` is set up on
  Railway, deploy prod against it: `VITE_API_BASE=https://api.momome.xyz/api bash scripts/deploy-hostinger.sh`.
- **SEO/canonical:** both builds use `https://momome.xyz` as the canonical, so
  the Vercel staging copy points search engines at the real production domain
  (it won't compete for indexing). Optionally add a `noindex` to the vercel.app
  domain if you want it fully hidden.
- **Rollback:** Vercel keeps every deployment; the live Hostinger site is just
  files — re-run `deploy-hostinger.sh` from an earlier commit, or point
  `momome.xyz` DNS back at Vercel.

---

## CI/CD: what is automated, and what is not (reviewed 2026-09-25)

Four workflows exist and are structurally sound — `deploy.yml` gates the Railway deploy on
`needs: test`, `mobile.yml` typechecks before publishing an OTA, and every script they
reference is present. **None of them has ever run.**

### 1. The account is locked

Every Actions run on this repo — 60 of 60 in the window checked, back to 22 September —
fails in about two seconds with no runner assigned and no logs. The reason is not in the
logs; it is in the check-run annotation:

> The job was not started because your account is locked due to a billing issue.

Fix at **github.com/settings/billing**. Nothing in this repository can work around it.

### 2. Four required secrets are missing

Even once billing is resolved, `deploy.yml` and `mobile.yml` will fail: only the five
`HOSTINGER_*` secrets are set.

| Secret | Needed by | What it is |
|---|---|---|
| `RAILWAY_TOKEN` | `deploy.yml` | Railway project/account token (`railway login` locally uses a different one) |
| `PRODUCTION_API_URL` | `deploy.yml` | `https://momome-api-production.up.railway.app` |
| `STAGING_API_URL` | `deploy.yml` (staging only) | the staging API base |
| `EXPO_TOKEN` | `mobile.yml` | Expo access token with access to the `momome` project |

Set them without the value passing through a shell history or a chat transcript:

```bash
gh secret set RAILWAY_TOKEN          # prompts, input hidden
gh secret set EXPO_TOKEN
gh secret set PRODUCTION_API_URL --body "https://momome-api-production.up.railway.app"
```

### Until then, deploy by hand — both paths exist

| Surface | Command | Gate |
|---|---|---|
| Server (Railway) | `scripts/deploy.sh production` | deep health + synthetic quote on the NEW build, auto-rollback |
| Mobile (OTA) | `scripts/deploy-mobile.sh ota` | mobile typecheck; refuses to publish a bundle that does not compile |
| Mobile (store) | `scripts/deploy-mobile.sh build` | queues EAS builds; submission stays manual |
| Web (Vercel) | automatic on push — Vercel's own Git integration, independent of Actions | Vercel's build |

Vercel is why the web stayed current through all of this: it never used GitHub Actions.

### Before pushing, run the gate CI would have

```bash
pnpm check     # typecheck app + server + MOBILE, then every test
```

`npm test` inside `server/` is **not** that gate. A change to `shared/types.ts` that breaks
the mobile app passes the server chain and the web build and is caught only here — which is
exactly how a non-compiling mobile app reached `main` on 2026-09-24.
