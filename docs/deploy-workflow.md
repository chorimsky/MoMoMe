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

# 3. happy? ship the same code to the live site:
bash scripts/deploy-hostinger.sh
```

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
