# F11 + F12 — workspace and hygiene

Neither takes an afternoon. Do them in one PR.

---

## F11 — the root can't run the tests

`server/package.json` has a real suite wired into `pnpm test`: settlement idempotency,
store contract, payouts, rail registry, rail health, outbound, rate parsing. The root
manifest has `dev`, `build` and `typecheck` and no `test`, so nothing runs them from the
top — and any CI that does the obvious thing runs nothing.

`package.json` (root):

```diff
   "scripts": {
     "dev": "pnpm -r --parallel dev",
     "dev:app": "pnpm --filter @momome/app dev",
     "dev:server": "pnpm --filter @momome/server dev",
     "build": "pnpm --filter @momome/server build && pnpm --filter @momome/app build",
-    "typecheck": "pnpm -r typecheck"
+    "typecheck": "pnpm -r typecheck",
+    "test": "pnpm -r test",
+    "check": "pnpm typecheck && pnpm test"
   },
```

And drop the stray dependency — it directly contradicts `mobile/README.md`, which states
the mobile app is deliberately **not** a workspace member so its dependency churn can't
break the deployed stacks:

```diff
-  "dependencies": {
-    "expo": "^57.0.12"
-  }
```

Then `pnpm install` at the root to prune the lockfile, and confirm
`cd mobile && npm install && npx expo start` still works — it has its own `node_modules`,
so it should be unaffected. That's the whole point of the isolation.

### Lint

There is no lint step, and it shows: `markDetected` in `stateMachine.ts` contains

```ts
await await transition(p, "INBOUND_DETECTED");
```

Harmless. But this is the most safety-critical file in the repo, and a double `await` is
exactly the kind of thing a linter catches for free. Add ESLint with
`@typescript-eslint`, `no-floating-promises` and `await-thenable` on, and put it in
`check`. Expect a first pass with real findings — the codebase leans on `void promise` in
several places, which is intentional and should be annotated rather than silenced.

---

## F12 — committed build residue

What's in the tree that shouldn't be:

| Path | What |
|---|---|
| `.DS_Store`, `server/.DS_Store`, `server/src/.DS_Store` | macOS metadata |
| `momome-hostinger.zip` | deployment artifact |
| `mobile/.*.log` (~15) | build/install/emulator logs |
| `mobile/.gradle-dl.sh`, `.native-install.sh`, `.retry-install.sh`, `.vec-install.sh`, `.android-gradle.sh` | ad-hoc one-off scripts |
| `mobile/.cfgerr.txt` | stray error dump |
| `data/momome.db`, `server/data/momome.db`, `server/server/data/momome.db` | **three** databases |

`.gitignore` (root):

```diff
+# macOS
+.DS_Store
+
+# deployment artifacts
+*.zip
+
+# build / tooling logs and one-off scripts
+*.log
+mobile/.*.log
+mobile/.*.sh
+mobile/.cfgerr.txt
+
+# local databases (see docs — the canonical path is server/data/)
+**/*.db
```

Then:

```bash
git rm -r --cached . && git add . && git commit -m "chore: purge build residue from the tree"
```

### The database question is not cosmetic

Three copies of `momome.db`, one at the nested path `server/server/data/`. That last one
almost certainly came from a `cwd` mismatch between `pnpm dev` (run from the repo root)
and `pnpm --filter @momome/server dev` (run from `server/`) — the relative `DB_PATH`
resolved differently and a second database appeared.

Before deleting anything: check which one the running server actually opens, and whether
any has rows the others don't. A stray database in a settlement system is a stray ledger.
Resolve `DB_PATH` to an absolute path off the package root so it can't happen again.

---

## The scripts directory

`scripts/` holds `deploy-hostinger.sh`, `deploy-railway.sh`, `build-hostinger.sh`,
`go-live.sh`, `fetch-wavelength-runtime.sh`, plus two PawaPay test scripts — and `docs/`
has both `deploy-workflow.md` and `hostinger-migration.md`. That reads like three
deployment targets, at least one of which is historical.

Not a defect, but a new engineer can't tell which one is real. One line at the top of each
script saying whether it's current or superseded costs nothing and saves an afternoon.
