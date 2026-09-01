# Vercel environment setup — `mo-mo-me-server`

Two generated files sit in the repo root. They are **gitignored** (`.gitignore:16` → `.env.*`)
and must never be committed or pasted into chat:

| file | upload to |
|---|---|
| `.env.vercel-production` | Environment Variables → **Production** |
| `.env.vercel-preview` | Environment Variables → **Preview** (the sandbox) |

The random secrets in them were generated locally with a CSPRNG. Everything else is either
a known-correct config value or a blank you fill in.

## Fill these before uploading

**`.env.vercel-production`**
- `IBEX_CLIENT_ID`, `IBEX_CLIENT_SECRET`, `IBEX_ACCOUNT_ID` — from IBEX. Use **rotated**
  credentials; the ones shared earlier are compromised.
- `ADMIN_PASSWORD` — the current one was exposed and should be replaced.

**`.env.vercel-preview`**
- `DATABASE_URL` — a **separate** database. Sharing production's means sandbox testing
  writes into the real ledger. Connect one of the Neon databases to Preview scope, or paste
  its URL here.
- `ADMIN_PASSWORD` — a different value from production.

Leave a line blank and Vercel simply won't set it; nothing silently half-configures.

## Importing

Environment Variables → **Import .env** → choose the file → select the target environment.
Import **one file per environment** and confirm the scope each time — the whole point of the
split is that production credentials never reach a preview deployment.

Then **redeploy**. Environment changes do not apply to a deployment that is already running.

## Two deliberate choices

**`RAILS_MODE=sandbox` in the production file, on purpose.** `IBEX_ENV=production` is what
makes real money move — `liveMoney()` is driven by the per-rail `*_ENV` values, not by
`RAILS_MODE`. Setting `RAILS_MODE=live` additionally demands `PEEXIT_API_KEY` and
`PEEXIT_CALLBACK_PASS`, and the server refuses to boot without them. Since Peexit is not
ready, `sandbox` here keeps the boot gates satisfied while IBEX goes live. Change it to
`live` only when the payout rail is genuinely ready. (`production` is **not** a valid value
and is rejected at boot.)

**`DATABASE_URL` is absent from the production file.** It is already set on Vercel, and
re-importing it risks overwriting a working value. It is present in the preview file because
that one does not exist yet.

## Verification

The production file was run against the real `runBootChecks()` with the blanks filled:

```
as packaged              BOOTS
+ VERCEL_ENV=production  BOOTS
+ VERCEL_ENV=preview     REFUSES — preview deployments must never run a live rail
```

That last line is the safety net: if the production file is ever uploaded to the wrong
scope, the deployment fails loudly instead of quietly becoming a second production.

After redeploying, open **Admin → Go-live readiness** (Super Admin). Every gate should read
OK, and a Lightning payment's `payInstruction.provider` should say `ibex` rather than
`sandbox`.
