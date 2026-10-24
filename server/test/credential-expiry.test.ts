/* ============================================================
   Credential expiry — bounding a leak nobody noticed.

   A permanent bearer secret with good hygiene around it (scopes, IP allow-list, rotation
   with grace) is still a permanent bearer secret: a key that leaked a year ago works as
   well today as it did then. An expiry is the one property that puts a floor under that.

   What the tests hold the implementation to:
     • a credential with no expiry never expires, so nothing already deployed stops working;
     • an expired key is refused as EXPIRED, not as revoked — the remedy differs, and
       "revoked" sends a developer looking for a decision nobody took;
     • an UNPARSEABLE expiry is treated as expired, not as forever: a typo in an admin form
       must not mint a key that no date can ever retire;
     • rotation carries the LIFETIME forward, not the instant — rotating an almost-expired
       90-day key gives 90 fresh days, not the three that were left.
   Run: pnpm --filter @momome/server test:credexp
   ============================================================ */
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { createCredential, authenticate, rotateCredential, updateCredential, credentialExpired, getCredential, _setCredentialTimestamps } = await import("../src/core/platform/credentials.js");
  const { createOrganization, applicationsOf } = await import("../src/core/platform/orgs.js");

  const org = createOrganization({ name: "Expiry Co", ownerUserId: "u1" });
  const appId = applicationsOf(org.id)[0]?.id ?? "app_default";
  const mint = (over: Record<string, unknown> = {}) =>
    createCredential({ orgId: org.id, appId, env: "test", label: "k", createdBy: "u1", ...over } as Parameters<typeof createCredential>[0]);

  console.log("\nCredential expiry");

  /* 1. The migration guarantee. */
  const permanent = mint();
  assert.ok(permanent.ok);
  ok("a credential minted with no expiry has none", permanent.credential.expiresAt === undefined);
  ok("…and authenticates", authenticate(permanent.secret).ok === true);
  ok("…and is never 'expired', however far in the future you ask", !credentialExpired(permanent.credential, Date.now() + 100 * 365 * 86_400_000));

  /* 2. A dated key works until its date. */
  const dated = mint({ expiresInDays: 30 });
  assert.ok(dated.ok);
  ok("expiresInDays sets a date about 30 days out", Math.round((Date.parse(dated.credential.expiresAt!) - Date.now()) / 86_400_000) === 30, dated.credential.expiresAt);
  ok("…and it authenticates today", authenticate(dated.secret).ok === true);
  ok("…and is not expired today but is after its date", !credentialExpired(dated.credential) && credentialExpired(dated.credential, Date.now() + 31 * 86_400_000));

  /* 3. An expired key is refused, and refused as expired. A real short-lived credential
        and a real wait: getCredential returns a COPY, so the first version of this test
        mutated a detached object and asserted against an unexpired key — it passed for the
        wrong reason until the assertion was tightened. */
  const soon = mint({ expiresInDays: 1 });
  assert.ok(soon.ok);
  const in1200ms = new Date(Date.now() + 1_200).toISOString();
  updateCredential(soon.credential.id, { expiresAt: in1200ms });
  ok("a near-future expiry is accepted and stored", getCredential(soon.credential.id)?.expiresAt === in1200ms, String(getCredential(soon.credential.id)?.expiresAt));
  ok("…and the key still authenticates before it lapses", authenticate(soon.secret).ok === true);
  await new Promise((r) => setTimeout(r, 1_400));
  const refused = authenticate(soon.secret);
  ok("…and is refused once it has", refused.ok === false);
  ok("…as EXPIRED, not as revoked", refused.ok === false && refused.reason === "expired", refused.ok ? "" : refused.reason);

  /* 4. A past date cannot be set through the normal path — revoke says what it means. */
  const guarded = mint({ expiresInDays: 10 });
  assert.ok(guarded.ok);
  const before = getCredential(guarded.credential.id)?.expiresAt;
  updateCredential(guarded.credential.id, { expiresAt: "2001-01-01T00:00:00Z" });
  ok("a past expiry is not accepted by updateCredential", getCredential(guarded.credential.id)?.expiresAt === before, String(getCredential(guarded.credential.id)?.expiresAt));
  updateCredential(guarded.credential.id, { expiresAt: null });
  ok("…and null clears it back to permanent", getCredential(guarded.credential.id)?.expiresAt === undefined);

  /* 5. A nonsense expiry is expired, not eternal. */
  ok("an unparseable expiry counts as expired", credentialExpired({ expiresAt: "not a date" }) === true);
  const badInput = mint({ expiresAt: "also not a date" });
  assert.ok(badInput.ok);
  ok("…and a nonsense input at minting is ignored rather than stored", badInput.credential.expiresAt === undefined);
  const pastInput = mint({ expiresAt: "2001-01-01T00:00:00Z" });
  assert.ok(pastInput.ok);
  ok("…as is a past one, so minting never produces an unusable key", pastInput.credential.expiresAt === undefined && authenticate(pastInput.secret).ok === true);

  /* 6. Rotation renews the LIFETIME, not the remainder. The distinguishing case needs an
        AGED key: rotating a fresh 90-day key would give 90 days either way, so a test that
        skipped the back-dating could not tell "carry the lifetime" from "copy the instant"
        — which is precisely the bug this guards. getCredential hands back a copy, so the
        back-dating goes through the labelled test-only hook. */
  const ninety = mint({ expiresInDays: 90 });
  assert.ok(ninety.ok);
  _setCredentialTimestamps(ninety.credential.id, {
    createdAt: new Date(Date.now() - 87 * 86_400_000).toISOString(),  // issued 87 days ago
    expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),   // 3 days left
  });
  const aged = getCredential(ninety.credential.id)!;
  ok("the key really is almost expired before rotating", Math.round((Date.parse(aged.expiresAt!) - Date.now()) / 86_400_000) === 3, aged.expiresAt);
  const rolled = rotateCredential(ninety.credential.id, "u1");
  assert.ok(rolled.ok);
  const freshDays = Math.round((Date.parse(rolled.credential.expiresAt!) - Date.now()) / 86_400_000);
  ok("rotating it gives 90 fresh days, not the 3 that were left", freshDays === 90, `${freshDays} days`);
  ok("…and the old secret stops working", authenticate(ninety.secret).ok === false);
  ok("…while the new one works", authenticate(rolled.secret).ok === true);

  /* 7. A permanent key rotates to a permanent key — rotation must not invent a policy. */
  const perm2 = mint();
  assert.ok(perm2.ok);
  const rolled2 = rotateCredential(perm2.credential.id, "u1");
  assert.ok(rolled2.ok);
  ok("rotating a permanent key does not give it an expiry", rolled2.credential.expiresAt === undefined);

  console.log(`\n✅ credential-expiry: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
