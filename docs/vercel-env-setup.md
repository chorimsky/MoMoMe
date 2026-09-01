# Vercel environment setup — `mo-mo-me-server`

Two generated files sit in the repo root. They are **gitignored** (`.gitignore` → `vercel-env/`)
and must never be committed or pasted into chat:

| file | upload to |
|---|---|
| `vercel-env/production.env` | Environment Variables → **Production** |
| `vercel-env/preview.env` | Environment Variables → **Preview** (the sandbox) |

The filename matters: Vercel's importer only accepts a file whose name ends in `.env`, which
is why these are `production.env` / `preview.env` rather than `.env.vercel-production`.
Vercel also rejects a key with an empty value, so **no blank keys are in these files** — the
credentials only you hold are added afterwards, in the dashboard.

The random secrets in them were generated locally with a CSPRNG. Everything else is either
a known-correct config value or a blank you fill in.

## Add these yourself, after importing

Import the file first, then **Add Environment Variable** for each of these. They are the
values only you hold, so they are deliberately not in the packaged files.

**Production**
- `IBEX_CLIENT_ID`, `IBEX_CLIENT_SECRET`, `IBEX_ACCOUNT_ID` — from IBEX. Use **rotated**
  credentials; the ones shared earlier are compromised.
- `ADMIN_PASSWORD` — already set on Vercel. Replace it: the current value was exposed.

**Preview**
- `DATABASE_URL` — a **separate** database. Sharing production's means sandbox testing
  writes into the real ledger. Connect one of the Neon databases to Preview scope, or paste
  its URL here.
- `ADMIN_PASSWORD` — a different value from production.

Importing `production.env` before adding the IBEX credentials is safe and boots normally:
`IBEX_ENV=production` on its own does nothing, because `ibexConfigured()` needs all three
credentials before the rail counts as live. So the import and the go-live are two separate,
deliberate steps.

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
production.env as imported (no credentials yet)   BOOTS   liveMoney=false ibexLive=false
production.env + IBEX credentials                 BOOTS   liveMoney=true  ibexLive=true
production.env mis-uploaded to Preview scope      REFUSES — preview must never run a live rail
preview.env as imported                           BOOTS   liveMoney=false ibexLive=false
```

That last line is the safety net: if the production file is ever uploaded to the wrong
scope, the deployment fails loudly instead of quietly becoming a second production.

After redeploying, open **Admin → Go-live readiness** (Super Admin). Every gate should read
OK, and a Lightning payment's `payInstruction.provider` should say `ibex` rather than
`sandbox`.
