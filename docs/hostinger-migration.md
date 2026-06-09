# MoMo›Me — Hostinger migration runbook

**Target architecture:** frontend (static React SPA) on **Hostinger** at `momome.xyz`;
backend (Node settlement engine) stays on **Railway**, reached at `api.momome.xyz`.

> Why this split: Hostinger Cloud/shared hosting can't run the always-on Node
> backend (background reconcilers idle out, no `node:sqlite`/webhooks). The
> static frontend runs there perfectly; the backend stays on Railway.

Everything below is run by **you** (I can't access your Hostinger/Railway/DNS).
The codebase is already prepared (build script, `.htaccess`, domain/SEO updated,
backend CORS already allows `momome.xyz`).

---

## 1. Point `api.momome.xyz` at the Railway backend

1. **Railway → momome-api service → Settings → Networking → Custom Domain** →
   add `api.momome.xyz`. Railway shows a **CNAME target** (e.g. `xxxx.up.railway.app`).
2. **Hostinger → hPanel → Domains → DNS Zone** for `momome.xyz`, add:
   - `CNAME`  **api**  → `<the Railway CNAME target>`  (TTL 300)
3. Wait for it to verify (Railway shows "Active"), then confirm:
   ```
   curl -s https://api.momome.xyz/api/config -o /dev/null -w "%{http_code}\n"   # → 200
   ```

## 2. Update the backend's public URL + webhooks

1. **Railway → momome-api → Variables**: set
   ```
   PUBLIC_URL = https://api.momome.xyz
   ```
   Redeploy (`railway up --service momome-api`, or it redeploys on var change).
   On boot the IBEX account webhook re-registers to the new URL automatically.
2. **Update the dashboard callback URLs** to the new host:
   - **PawaPay dashboard** → callback `https://api.momome.xyz/webhooks/pawapay`
   - **Peexit dashboard** (when live) → `https://api.momome.xyz/webhooks/peexit`
   - IBEX is automatic (step above).
3. (CORS already allows `https://momome.xyz` and `*.momome.xyz` — no change.)

## 3. Build the frontend for Hostinger

From the repo:
```bash
bash scripts/build-hostinger.sh
# defaults: VITE_API_BASE=https://api.momome.xyz/api  SITE_URL=https://momome.xyz
```
Produces `app/dist/` (with `.htaccess`) and `momome-hostinger.zip`.

> Not ready to point `api.momome.xyz` yet? Build against Railway directly:
> ```bash
> VITE_API_BASE=https://momome-api-production.up.railway.app/api bash scripts/build-hostinger.sh
> ```

## 4. Upload to Hostinger

**hPanel → File Manager → `public_html`** (delete any default `index.html` first):
- Upload **`momome-hostinger.zip`** into `public_html`, then **Extract** it there, OR
- Upload the **contents** of `app/dist/` (including the hidden **`.htaccess`** — enable
  "show hidden files" in File Manager, or use FTP).

`public_html` should end up containing `index.html`, `.htaccess`, `assets/`,
`og/`, `sitemap.xml`, the SEO folders, etc.

## 5. Point `momome.xyz` at Hostinger + SSL

1. If `momome.xyz` isn't already the primary domain of the hosting plan, attach it
   in **hPanel → Websites**, and ensure DNS:
   - `A` **@** → your Hostinger site IP (shown in hPanel),  `CNAME` **www** → `momome.xyz`.
2. **hPanel → Security → SSL** → issue/enable the free SSL for `momome.xyz`
   (and `www`). Force HTTPS (the `.htaccess` also forces it).

## 6. Verify

```bash
curl -sI https://momome.xyz | grep -i -E "x-frame-options|content-security|strict-transport"   # headers present
curl -s  https://momome.xyz/sitemap.xml -o /dev/null -w "%{http_code}\n"                        # 200
curl -sI https://momome.xyz/.well-known/lnurlp/677000789 | grep -i location                     # → 302 to api.momome.xyz
```
In a browser:
- `https://momome.xyz` loads; the **Pay** flow creates a quote (DevTools → Network
  shows calls to `api.momome.xyz` returning 200 — confirms CORS).
- A deep link like `https://momome.xyz/send` and `/admin` load (SPA fallback).
- Lightning Address `677000789@momome.xyz` resolves (the `.htaccess` 302 →
  `api.momome.xyz/.well-known/lnurlp/...`). Note: a few strict wallets don't follow
  redirects — if that matters, advertise `…@api.momome.xyz` or move to a VPS reverse proxy.

## 7. Cutover & rollback

- **Cutover** is the DNS flip in step 5 (`momome.xyz` → Hostinger).
- **Rollback:** the Vercel deployment still exists (`mo-mo-me-app.vercel.app`) and
  still auto-builds on push. Point `momome.xyz` back to Vercel (or just use the
  Vercel URL) if anything's wrong. Railway backend is unchanged either way.

## Notes / caveats
- **Updating the site later:** re-run `scripts/build-hostinger.sh` and re-upload
  `public_html`. (Or keep using Vercel as a staging mirror.)
- **`.htaccess` is required** for SPA routing, security headers, and the LNURL
  redirect — make sure it uploaded (it's a hidden file).
- **LNURL on the apex** relies on a 302 redirect because Apache shared/cloud
  hosting blocks reverse-proxying. The clean fix (true `momome.xyz/.well-known`
  proxy) needs a VPS with nginx — see the "all-in-one VPS" option if you want it.
