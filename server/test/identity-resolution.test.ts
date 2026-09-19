/* Identity Resolution v2 — normalization, operator detection, provider chain and fallback,
   states, cache/TTL, name matching, error mapping, the V2 API's auth / purpose / rate limits /
   enumeration guard, the payment-intent snapshot and its immutability, and the flag.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox IDENTITY_RESOLUTION_ENABLED=true tsx test/identity-resolution.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";
process.env.IDENTITY_CACHE_TTL = "60";
process.env.IDENTITY_RATE_LIMIT = "8";
process.env.IDENTITY_MAX_DISTINCT_PER_HOUR = "6";
process.env.LEGACY_SENDER_UNTIL = "2000-01-01T00:00:00Z";
import type { AddressInfo } from "node:net";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { normalizeMsisdn, identifierHash } = await import("../src/core/identityResolution/msisdn.js");
  const { matchNames, normalizeName } = await import("../src/core/identityResolution/names.js");
  const { resolveIdentity, providerChain, capabilityConfig, cachedSnapshot } = await import("../src/core/identityResolution/resolver.js");
  const { IdentityError } = await import("../src/core/identityResolution/errors.js");
  const { cached, pruneIdentityRecords } = await import("../src/core/identityResolution/cache.js");
  const { auditRows, metricsSnapshot } = await import("../src/core/identityResolution/audit.js");
  const { createApp } = await import("../src/app.js");
  const { store } = await import("../src/db/store.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");

  console.log("\nMSISDN normalization\n");
  for (const raw of ["674123456", "+237674123456", "237674123456", "6 74 12 34 56", "+237 674 12 34 56"]) {
    const n = normalizeMsisdn(raw, "CM");
    ok(`"${raw}" → +237674123456 / CM / MTN / XAF`, n.identifier === "+237674123456" && n.country === "CM" && n.operator === "MTN" && n.currency === "XAF" && n.countryCode === "237" && n.nationalNumber === "674123456");
  }
  ok("an Orange prefix resolves to ORANGE", normalizeMsisdn("699000155", "CM").operator === "ORANGE");
  ok("a Kenyan number resolves to KE / KES with a market operator", (() => { const n = normalizeMsisdn("+254712345678"); return n.country === "KE" && n.currency === "KES" && !!n.operator; })());
  const bad = (s: string) => { try { normalizeMsisdn(s, "CM"); return null; } catch (e) { return (e as InstanceType<typeof IdentityError>).code; } };
  ok("garbage is IDENTITY_INVALID_IDENTIFIER, not sent anywhere", bad("abc") === "IDENTITY_INVALID_IDENTIFIER" && bad("12") === "IDENTITY_INVALID_IDENTIFIER");
  ok("an unsupported country is IDENTITY_UNSUPPORTED_COUNTRY", bad("+14155552671") === "IDENTITY_UNSUPPORTED_COUNTRY");
  ok("an unsupported Cameroon prefix (Camtel 62x) has no operator", normalizeMsisdn("620000000", "CM").operator === null);
  ok("the hash is keyed and stable, and never the number", identifierHash("+237674123456") === identifierHash("+237674123456") && !identifierHash("+237674123456").includes("674"));

  console.log("\nName matching\n");
  ok("case, accents and spacing are normalised", normalizeName("Jean-Paul  NANÁ").join(" ") === "JEAN PAUL NANA");
  ok("MATCH", matchNames("John Doe", "JOHN  DOE") === "MATCH");
  ok("PARTIAL_MATCH (one token)", matchNames("John Doe", "JOHN MICHAEL DOE") === "PARTIAL_MATCH");
  ok("NO_MATCH", matchNames("John Doe", "MICHAEL SMITH") === "NO_MATCH");
  ok("NOT_AVAILABLE when either side is missing", matchNames(undefined, "X") === "NOT_AVAILABLE" && matchNames("X", undefined) === "NOT_AVAILABLE");

  console.log("\nProvider chain and capabilities (sandbox, no real credentials)\n");
  const chain = providerChain("CM", "MTN");
  ok("with no MTN credentials the chain is the sandbox provider only", chain.map((p) => p.name).join() === "sandbox", chain.map((p) => p.name).join());
  const caps = capabilityConfig();
  ok("capabilities come from configured AUTHORITATIVE providers, so CM.MTN.identity_resolution is false here", caps.CM.MTN.identity_resolution === false && caps.CM.MTN.provider === null);

  console.log("\nResolution states\n");
  let r = await resolveIdentity({ identifier: "670123456", purpose: "RECIPIENT_VERIFICATION", actor: "dev-a" });
  ok("a verified account → VERIFIED with the provider's name, source labelled sandbox", r.status === "VERIFIED" && r.verified && r.displayName === "NANA JEAN PAUL" && r.source === "sandbox" && r.provider.name === "sandbox", JSON.stringify([r.status, r.displayName, r.source]));
  ok("…with capabilities and an expiry", r.capabilities.payout && !!r.expiresAt);
  const r2 = await resolveIdentity({ identifier: "670123456", purpose: "RECIPIENT_VERIFICATION", actor: "dev-a", expectedName: "Nana Jean-Paul" });
  ok("the second call is a cache hit with a name match", r2.source === "cache" && r2.nameMatch === "MATCH");
  r = await resolveIdentity({ identifier: "670123459", purpose: "RECIPIENT_VERIFICATION", actor: "dev-a" });
  ok("no such account → NOT_FOUND with the error code, no name", r.status === "NOT_FOUND" && !r.displayName && r.error === "IDENTITY_NOT_FOUND");
  r = await resolveIdentity({ identifier: "670123458", purpose: "RECIPIENT_VERIFICATION", actor: "dev-a" });
  ok("an inactive account → INACTIVE, not verified", r.status === "INACTIVE" && !r.verified && r.accountStatus === "INACTIVE");
  r = await resolveIdentity({ identifier: "670123000", purpose: "RECIPIENT_VERIFICATION", actor: "dev-a" });
  ok("a provider timeout → PROVIDER_UNAVAILABLE, NEVER NOT_FOUND, no name", r.status === "PROVIDER_UNAVAILABLE" && r.error === "IDENTITY_PROVIDER_TIMEOUT" && !r.displayName);
  ok("…and an outage is not cached", cached(identifierHash("+237670123000")) === null);
  r = await resolveIdentity({ identifier: "620000000", purpose: "RECIPIENT_VERIFICATION", actor: "dev-a" });
  ok("an unsupported operator → UNSUPPORTED", r.status === "UNSUPPORTED" && r.error === "IDENTITY_UNSUPPORTED_OPERATOR");
  ok("every request is audited by hash, never by number", auditRows(20).every((a) => !/\d{9}/.test(JSON.stringify(a))) && auditRows(20).length >= 5);
  const m = metricsSnapshot();
  ok("metrics count total / success / not found / timeout / cache", m.identity_resolution_total >= 6 && m.identity_resolution_success >= 1 && m.identity_resolution_not_found >= 1 && m.identity_resolution_provider_timeout >= 1 && m.identity_resolution_cache_hit >= 1, JSON.stringify(m));
  ok("record pruning keeps fresh records", pruneIdentityRecords() === 0 && cached(identifierHash("+237670123456")) !== null);

  console.log("\nV2 API — auth, purpose, limits, enumeration\n");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
  const b64url = (u8: Uint8Array) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwk = (priv: Uint8Array) => { const pub = p256.getPublicKey(priv, false); return { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) }; };
  const keys = new Map<string, Uint8Array>();
  const enroll = async (dev: string) => { const k = p256.utils.randomSecretKey(); keys.set(dev, k); const r = await fetch(`${base}/me/devices`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": dev }, body: JSON.stringify({ authPub: jwk(k), wrapPub: jwk(p256.utils.randomSecretKey()) }) }); if (r.status !== 200) throw new Error(`enrol ${r.status}`); };
  const call = async (p: string, dev: string | null, body: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...extra };
    const bodyStr = JSON.stringify(body);
    if (dev) { headers["x-mm-sender"] = dev; const priv = keys.get(dev); if (priv) { const ts = String(Date.now()); const msg = new TextEncoder().encode(`POST\n${p}\n${ts}\n${b64(sha256(new TextEncoder().encode(bodyStr)))}`); headers["x-mm-ts"] = ts; headers["x-mm-sig"] = b64(p256.sign(sha256(msg), priv, { prehash: false, lowS: true })); } }
    const r = await fetch(`${base}${p}`, { method: "POST", headers, body: bodyStr });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any>, headers: r.headers };
  };
  try {
    await enroll("dev-1"); await enroll("dev-2");
    let x = await call("/v2/identity/resolve", null, { identifier: "670123456", purpose: "RECIPIENT_VERIFICATION" });
    ok("unauthenticated → 401 IDENTITY_UNAUTHORIZED", x.status === 401 && x.body.error === "IDENTITY_UNAUTHORIZED");
    x = await call("/v2/identity/resolve", "nobody", { identifier: "670123456", purpose: "RECIPIENT_VERIFICATION" });
    ok("an unsigned/un-enrolled device id → 401", x.status === 401);
    x = await call("/v2/identity/resolve", "dev-1", { identifier: "670123456" });
    ok("a request without a purpose is refused", x.status === 400);
    x = await call("/v2/identity/resolve", "dev-1", { identifier: "670123456", purpose: "RECIPIENT_VERIFICATION" });
    ok("signed device + purpose → the verified identity, public shape only", x.status === 200 && x.body.success && x.body.identity.display_name === "NANA JEAN PAUL" && x.body.identity.operator === "MTN" && x.body.identity.country === "CM" && x.body.identity.currency === "XAF" && x.body.identity.account_status === "ACTIVE" && x.body.mode === "advisory", JSON.stringify(x.body));
    ok("no provider reference / secrets in the response", !("reference" in x.body.identity) && !JSON.stringify(x.body).includes("sbx-"));
    ok("the response is not cacheable by intermediaries", x.headers.get("cache-control") === "no-store");
    x = await call("/v2/identity/resolve", "dev-1", { identifier: "670123000", purpose: "RECIPIENT_VERIFICATION" });
    ok("provider unavailable → success false, status PROVIDER_UNAVAILABLE, the honest message", x.status === 200 && !x.body.success && x.body.identity.status === "PROVIDER_UNAVAILABLE" && /temporarily unavailable/.test(x.body.message));
    x = await call("/v2/identity/resolve", "dev-1", { identifier: "670123459", purpose: "RECIPIENT_VERIFICATION" });
    ok("not found → 'couldn't verify', not 'does not exist'", x.body.identity.status === "NOT_FOUND" && /couldn't verify/.test(x.body.message));
    x = await call("/v2/identity/verify", "dev-1", { identifier: "670123456", purpose: "PAYMENT_CREATION", expected_name: "Michael Smith" });
    ok("verify with a mismatching name → VERIFICATION_FAILED / NO_MATCH, success false", !x.body.success && x.body.identity.status === "VERIFICATION_FAILED" && x.body.identity.name_match === "NO_MATCH");
    x = await call("/v2/identity/verify", "dev-1", { identifier: "670123456", purpose: "PAYMENT_CREATION", expected_name: "nana jean paul" });
    ok("verify with the right name → MATCH", x.body.success && x.body.identity.name_match === "MATCH");
    x = await call("/v2/identity/resolve", "dev-1", { identifier: "'; DROP TABLE x; --", purpose: "RECIPIENT_VERIFICATION" });
    ok("a malformed identifier is a 400, never forwarded", x.status === 400 && x.body.error === "IDENTITY_INVALID_IDENTIFIER");
    // Enumeration: dev-2 sweeps many distinct numbers.
    let limited = 0;
    for (let i = 0; i < 8; i++) { const y = await call("/v2/identity/resolve", "dev-2", { identifier: `67012${String(3400 + i)}`, purpose: "RECIPIENT_VERIFICATION" }); if (y.status === 429) limited++; }
    ok("sweeping distinct numbers from one device is rate-limited (429 IDENTITY_RATE_LIMITED)", limited > 0, `${limited} limited`);
    const admin = createUser("id-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
    const A = { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token };
    const h = await fetch(`${base}/v2/identity/health`, { headers: A }).then((r) => r.json()) as Record<string, any>;
    ok("admin health lists every provider with configured/status and the metrics", Array.isArray(h.providers) && h.providers.some((p: any) => p.name === "mtn_direct" && p.status === "NOT_CONFIGURED") && h.providers.some((p: any) => p.name === "sandbox" && p.status === "SANDBOX") && h.metrics.identity_resolution_total > 0);
    ok("health is admin-only", (await fetch(`${base}/v2/identity/health`, { headers: { "x-mm-sender": "dev-1" } })).status === 401);
    const pv = await fetch(`${base}/v2/identity/providers`, { headers: A }).then((r) => r.json()) as Record<string, any>;
    ok("the capability table is exposed without secrets", pv.capabilities?.CM?.MTN && !JSON.stringify(pv).toLowerCase().includes("key"));

    console.log("\nPayment intent integration (advisory)\n");
    const cfg = await fetch(`${base}/config`).then((r) => r.json()) as Record<string, any>;
    ok("/config announces identity resolution on, advisory", cfg.identity?.enabled === true && cfg.identity.mode === "advisory");
    const H = { "content-type": "application/json", "x-mm-sender": "dev-1" };
    const signedJson = async (p: string, body: unknown) => call(p, "dev-1", body);
    const q = await signedJson("/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    const pay = await signedJson("/payments", { quoteId: q.body.id, recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "Nana Jean Paul" } });
    ok("a payment to a resolved recipient carries the identity snapshot", pay.status === 200 && pay.body.recipientIdentity?.verified === true && pay.body.recipientIdentity.displayName === "NANA JEAN PAUL" && pay.body.recipientIdentity.nameMatch === "MATCH", JSON.stringify(pay.body.recipientIdentity));
    const q2 = await signedJson("/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    const pay2 = await signedJson("/payments", { quoteId: q2.body.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "Unresolved Person" } });
    ok("a payment to an UNRESOLVED recipient is created exactly as before (no snapshot, no provider call)", pay2.status === 200 && !pay2.body.recipientIdentity);
    const p1 = await store().getPayment(pay.body.id);
    await signedJson(`/payments/${pay.body.id}/simulate`, {});
    let del = await store().getPayment(pay.body.id);
    for (let i = 0; i < 40 && del?.state !== "DELIVERED"; i++) { await new Promise((r) => setTimeout(r, 250)); del = await store().getPayment(pay.body.id); }
    ok("the V1 flow delivered it unchanged", del?.state === "DELIVERED");
    ok("the snapshot on the delivered payment is byte-identical to the one at creation (immutable)", JSON.stringify(del?.recipientIdentity) === JSON.stringify(p1?.recipientIdentity));
    ok("cachedSnapshot never calls a provider: an unknown number is simply null", cachedSnapshot("699999999", "CM") === null);
    void H;

    console.log("\nFlag off = V1 exactly\n");
    process.env.IDENTITY_RESOLUTION_ENABLED = "false";
    x = await call("/v2/identity/resolve", "dev-1", { identifier: "670123456", purpose: "RECIPIENT_VERIFICATION" });
    ok("the surface answers 404 with the flag off", x.status === 404);
    const cfg2 = await fetch(`${base}/config`).then((r) => r.json()) as Record<string, any>;
    ok("/config says off", cfg2.identity?.enabled === false);
    const q3 = await signedJson("/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    const pay3 = await signedJson("/payments", { quoteId: q3.body.id, recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "Nana Jean Paul" } });
    ok("a payment created with the flag off carries no snapshot even though the cache has one", pay3.status === 200 && !pay3.body.recipientIdentity);
    process.env.IDENTITY_RESOLUTION_ENABLED = "true";
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
