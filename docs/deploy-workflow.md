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

## Store releases (verified against both stores, 2026-09-25)

The two stores are at completely different stages, which is worth writing down because the
repo reads as though they were symmetrical.

**Android is already live.** The Play production track holds `versionCode 6`; `8` has been
sitting in `internal` since 22 Sept. So an Android "go live" is a *promotion*, not a first
release. The service account at `mobile/.secrets/fcm-service-account.json` — despite the
`fcm-` name, it is a Firebase key that has been granted publishing rights on the Play app —
authenticates against `androidpublisher` and can create and discard edits on `momome.app`.
Nothing further is needed from the operator for Android.

Note the package names differ by platform and neither is a typo: iOS is `com.momome.app`,
Android is `momome.app`. A Play API call with the iOS identifier answers
`404 Package not found`, which reads like a permissions failure and is not one.

**iOS has never shipped.** `itunes.apple.com/lookup?id=6806540524` returns no result in any
storefront. The build exists, the app record exists, but no version has been released.

`eas.json`'s `submit.production.android` now targets `track: production` with
`releaseStatus: inProgress` and `rollout: 0.1`. A staged rollout, not 100%, because Play
cannot withdraw a bundle once live — it can only halt a rollout — and this build carries a
quarter's worth of change. Raise the fraction in the Play Console once it looks healthy.
`submit.internal` keeps the old behaviour for test builds.

### What is still blocked, and on whom

`eas submit --platform ios` needs App Store Connect credentials, which this repo does not
have and must not: either a team/individual **App Store Connect API key** (Issuer ID, Key ID
and the `AuthKey_*.p8`, dropped into the gitignored `mobile/.secrets/` and referenced as
`submit.production.ios.ascApiKeyPath`), or an interactive Apple sign-in run by the operator.
Only an Account Holder or Admin can mint a team key; any user can mint an individual one.

## Play testing tracks — what was actually there (reviewed 2026-09-25)

Worth writing down because the console showed several things that had been quietly broken or
unused, and none of them are visible from the repo.

**No pre-launch report has ever been generated.** This is Google's free device-farm crawl —
it installs the app on real hardware and reports crashes, ANRs, performance, accessibility,
security and privacy findings before a human reviewer sees it. The overview page was still
on its empty state ("Import artifacts to generate pre-launch reports"), which means the app
has never been run on Google's devices, across six uploads. A report is produced when a
bundle lands on a testing track.

Three deep links are now configured so the crawler reaches screens that are several taps
deep, rather than only the Send tab it lands on:

    momome://merchant · momome://activity · momome://settings

Test-account credentials are deliberately still "do not provide": the app has no login wall,
so the crawler can explore without them. Supplying the reviewer number and code would let it
past phone verification — a decision for the operator, not a default.

**Track state.** Internal: active, but on versionCode 8 while production serves 9. Closed:
two channels, "Momome Alpha test" and a duplicate "Alpha", neither with a release. Open:
**suspended**, holding a stale 1.0.0 and an unnamed draft.

The closed channel's checklist stood at 2 of 4: countries chosen and a draft release created,
but no testers selected — even though a "MoMoMe testers" mailing list with 3 people already
existed and simply had not been ticked. It is now ticked, feedback goes to info@momome.xyz,
and the draft holds bundle 9 (1.1.0) with English and French release notes.

### Why it was not submitted

Submitting raises a dialog: a review has been in progress since 25 September, and submitting
now **cancels and restarts it**. That review is the production phased rollout of 1.1.0 at
10%. A closed test track arriving an hour sooner is not worth delaying a release that is
already reaching users, so the changes are staged in the publication overview instead.

Once the production review clears, the publication overview's "Submit N changes for review"
sends them, and the pre-launch report follows from that upload.

### Two things noticed in passing

`versionCode 9` carries **no deobfuscation/mapping file**, so any crash or ANR from it
arrives unsymbolicated — stack traces of obfuscated names. Uploading the R8 mapping would fix
it, and EAS can be told to.

The console is showing an **Android developer validation** notice: package names and signing
keys used to distribute Android apps *outside* Google Play must be registered by
**30 September 2026** or those builds stop installing on certified devices in some countries.
Play-distributed apps are already registered. Worth confirming whether the preview APK we
hand out directly falls under this — it shares the package name but not necessarily the
signing key, since Play re-signs uploads with its own app signing key.
