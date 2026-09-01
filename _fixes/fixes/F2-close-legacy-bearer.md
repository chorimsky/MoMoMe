# F2 — close the legacy device-auth door

`server/src/routes/api.ts`, `server/src/core/deviceAccount.ts`

The signature scheme is good: ECDSA P-256 over `METHOD\npath\nts\nsha256(rawBody)`, ±5min
skew, verified against the exact raw bytes the client sent. It only protects ids that
opted in. `ownerOf()` returns the raw id for anything un-enrolled, so a leaked or guessed
`X-MM-Sender` is still a full bearer credential, and nothing forces enrollment.

Trust-on-first-use is a fine bootstrap. It is not a permanent tier.

## Patch — a dated cut-over, not a flag day

```diff
+/** After this instant, an un-enrolled sender id is no longer accepted as a bearer
+ *  credential for owner-scoped reads/writes. Devices enroll automatically on first
+ *  load (POST /me/devices), so the grace window only covers installs that never
+ *  return. Set LEGACY_SENDER_UNTIL in the env to move it; past the date, unset means
+ *  closed. */
+const LEGACY_SENDER_UNTIL = Date.parse(process.env.LEGACY_SENDER_UNTIL ?? "2026-11-01T00:00:00Z");
+const legacyBearerAllowed = () => Number.isFinite(LEGACY_SENDER_UNTIL) && Date.now() < LEGACY_SENDER_UNTIL;
+
 async function ownerOf(req: ReqLike): Promise<string | undefined> {
   // Developer/partner requests authenticate with an API key, not a device signature.
   const partner = partnerOf(req);
   if (partner) return partner;
   const id = senderOf(req);
   if (!id) return undefined;
   const dev = getDevice(id);
-  if (!dev) return id; // not enrolled yet → legacy path
+  // Un-enrolled id: accepted as a plain bearer only during the migration window.
+  // After it, an id with no enrolled key proves nothing and is refused — the client
+  // enrolls (POST /me/devices) and retries signed.
+  if (!dev) return legacyBearerAllowed() ? id : undefined;
   return (await verifyDeviceSig(req, dev.authPub)) ? id : undefined;
 }
```

## Companion — make the client enroll before it needs to

`app/src/lib/deviceAccount.ts` already owns enrollment. Two changes:

1. Enroll on app boot, not lazily on first vault write — so a returning user is already
   signed before they open Activity.
2. On a `401`/`404` from an owner-scoped route, enroll once and retry. That turns the
   cut-over into a silent upgrade for anyone who was mid-session.

## Verify

- With `LEGACY_SENDER_UNTIL` in the past: a raw `X-MM-Sender` with no signature → 404 on
  `/me/vault`, `/me/recipients`, `/payments`.
- The same id, enrolled and signing → 200.
- A wrong signature, or one older than 5 minutes → refused.
- Re-enrolling a *different* key for a known id → still 409 (`enrollDevice` conflict).
  That behaviour is correct and shouldn't change.

## Note on the tradeoff you already accepted

`deviceAccount.ts` documents it plainly: a device that loses its private key rotates to a
fresh id and its old data is unrecoverable. That's the right call for an anonymous,
no-login product — and the recovery-code escrow in `app/src/lib/vault.ts`
(`exportVaultForRecovery`) is the escape hatch. Worth surfacing that escape hatch in the
UI *before* the cut-over, not after.
