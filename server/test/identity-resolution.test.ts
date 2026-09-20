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
  const { resolveIdentity, providerChain, capabilityConfig, cachedSnapshot, providersHealth, _resetBreakers } = await import("../src/core/identityResolution/resolver.js");
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
  ok("a middle name the sender left out is still the same person", matchNames("John Doe", "JOHN MICHAEL DOE") === "MATCH");
  ok("PARTIAL_MATCH (two shared tokens, one that is not)", matchNames("John Doe Smith", "JOHN MICHAEL DOE") === "PARTIAL_MATCH");
  ok("NO_MATCH", matchNames("John Doe", "MICHAEL SMITH") === "NO_MATCH");
  ok("NOT_AVAILABLE when either side is missing", matchNames(undefined, "X") === "NOT_AVAILABLE" && matchNames("X", undefined) === "NOT_AVAILABLE");

  console.log("\nName matching — the one algorithm the server and both apps share\n");
  const { compareNames, namesMatch } = await import("../../shared/domain.js");
  const table: Array<[string, string, string]> = [
    ["Serge Manga", "MANGA SERGE", "MATCH"], ["S. Manga", "MANGA SERGE", "MATCH"], ["Jean-Paul Nana", "NANA JEAN PAUL", "MATCH"],
    ["Jeanpaul Nana", "NANA JEAN PAUL", "MATCH"], ["Aminatu Bello", "AMINATOU BELLO", "MATCH"], ["Mbala Rose", "MBALLA ROSE", "MATCH"],
    ["Ngo Marie", "N'GO MARIE CLAIRE", "MATCH"], ["Mme Ngo Marie Claire", "NGO MARIE CLAIRE", "MATCH"], ["John Doe", "JOHN MICHAEL DOE", "MATCH"],
    ["Nana", "NANA JEAN PAUL", "PARTIAL_MATCH"], ["Jean Nana Yves", "NANA JEAN PAUL", "PARTIAL_MATCH"],
    ["Jean Ngo", "JEAN MANGA", "NO_MATCH"], ["Alice Ngo", "MANGA SERGE", "NO_MATCH"], ["Nono Jean", "NANA JEAN PAUL", "NO_MATCH"], ["Paul Biya", "NANA JEAN PAUL", "NO_MATCH"],
    ["J. M.", "JEAN MANGA", "NOT_AVAILABLE"], ["Mr", "MANGA SERGE", "NOT_AVAILABLE"],
  ];
  for (const [a, b, want] of table) ok(`"${a}" vs "${b}" → ${want}`, compareNames(a, b) === want, compareNames(a, b));
  ok("a shared FIRST name alone is not a match (Jean is every third man)", !namesMatch("Jean Ngo", "JEAN MANGA"));
  ok("the identity module's matchNames IS compareNames", matchNames("Aminatu Bello", "AMINATOU BELLO") === "MATCH" && matchNames("Jean Ngo", "JEAN MANGA") === "NO_MATCH");

  console.log("\nPeexit verify-wallet provider (POST /clients/verify-wallet, mocked transport)\n");
  const { peexitVerify } = await import("../src/core/identityResolution/providers/peexit.js");
  const { config } = await import("../src/config.js");
  const idCM = normalizeMsisdn("699000155", "CM");
  const ctx = { purpose: "RECIPIENT_VERIFICATION" as const, requestId: "t", actor: "t", timeoutMs: 2000 };
  const realFetch = globalThis.fetch;
  const mock = (status: number, body: unknown, capture?: (init: RequestInit, url: string) => void) => { globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => { capture?.(init ?? {}, String(url)); return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }) as typeof fetch; };
  const savedKey = config.peexit.apiKey; (config.peexit as { apiKey: string }).apiKey = "test-key";
  try {
    ok("configured when the Peexit key is set; supports CM × MTN/ORANGE only", peexitVerify.configured() && peexitVerify.supports("CM", "ORANGE") && peexitVerify.supports("CM", "MTN") && !peexitVerify.supports("KE", "SAFARICOM"));
    let sent: { init: RequestInit; url: string } | null = null;
    mock(200, { isValid: true, accountName: "NGO MARIE CLAIRE", operator: "ORANGE", status: "ACTIVE" }, (init, url) => { sent = { init, url }; });
    let a = await peexitVerify.resolve(idCM, ctx);
    ok("VERIFIED with the operator's registered name and operator", a.status === "VERIFIED" && a.displayName === "NGO MARIE CLAIRE" && a.operator === "ORANGE" && a.accountStatus === "ACTIVE" && a.capabilities.payout, JSON.stringify(a));
    ok("…via POST /clients/verify-wallet { countryCode, accountNumber } with the SECRETKEY header", !!sent && sent!.url.endsWith("/clients/verify-wallet") && sent!.init.method === "POST" && JSON.parse(String(sent!.init.body)).countryCode === "CM" && JSON.parse(String(sent!.init.body)).accountNumber === "699000155" && (sent!.init.headers as Record<string, string>).SECRETKEY === "test-key", sent ? sent.url : "no call");
    mock(404, { error: { statusCode: 404, message: "Account not found on the provider network" } });
    a = await peexitVerify.resolve(idCM, ctx);
    ok("404 'Account not found on the provider network' → NOT_FOUND", a.status === "NOT_FOUND" && a.error === "IDENTITY_NOT_FOUND");
    mock(404, { error: { statusCode: 404, name: "Error", message: "Cannot POST /api/v1/clients/verify-wallet" } });
    const route404 = await peexitVerify.resolve(idCM, ctx).then(() => null, (x) => x as InstanceType<typeof IdentityError>);
    ok("404 'Cannot POST …' (endpoint missing on this base) → PROVIDER_UNAVAILABLE, NEVER 'not found' for the sender", route404?.code === "IDENTITY_PROVIDER_UNAVAILABLE" && route404.retryable === false && (await peexitVerify.health()).lastError?.includes("Cannot POST") === true, route404?.code);
    // The breaker: a route-404 rests the provider; the chain's verdict is then UNKNOWN
    // ("can't be verified yet"), never "temporarily unavailable, try again".
    process.env.IDENTITY_PROVIDER_PRIORITY = "peexit_verify,pawapay";
    mock(404, { error: { statusCode: 404, message: 'Endpoint "POST /v1/clients/verify-wallet" not found.' } });
    const rested = await resolveIdentity({ identifier: "699000177", purpose: "RECIPIENT_VERIFICATION", actor: "brk" });
    ok("an endpoint that is not there rests the provider and the sender gets UNKNOWN", rested.status === "UNKNOWN" && !rested.error, `${rested.status} ${rested.error ?? ""}`);
    let calls = 0; mock(200, { isValid: true, accountName: "X Y", operator: "ORANGE", status: "ACTIVE" }, () => { calls++; });
    const again = await resolveIdentity({ identifier: "699000178", purpose: "RECIPIENT_VERIFICATION", actor: "brk" });
    ok("…and is not asked again inside the window", calls === 0 && again.status === "UNKNOWN", `calls=${calls} status=${again.status}`);
    ok("…health shows it DOWN with the upstream message", (await providersHealth()).some((h) => h.name === "peexit_verify" && h.status === "DOWN" && /not found/.test(h.lastError ?? "")));
    delete process.env.IDENTITY_PROVIDER_PRIORITY; _resetBreakers();
    mock(200, "<html>ok</html>");
    const weird = await peexitVerify.resolve(idCM, ctx).then(() => null, (x) => x as InstanceType<typeof IdentityError>);
    ok("a 200 without the documented fields is UNAVAILABLE, not a verified account", weird?.code === "IDENTITY_PROVIDER_UNAVAILABLE");
    mock(200, { isValid: false, operator: "ORANGE", status: "SUSPENDED" });
    a = await peexitVerify.resolve(idCM, ctx);
    ok("isValid:false → INACTIVE, no name", a.status === "INACTIVE" && !a.displayName);
    mock(200, { isValid: true, operator: "MTN", status: "ACTIVE" });
    a = await peexitVerify.resolve(idCM, ctx);
    ok("a valid account WITHOUT a name → UNKNOWN (never a fabricated name, never VERIFIED)", a.status === "UNKNOWN" && !a.displayName && a.verified === false && a.capabilities.payout);
    const err = async (status: number, body: unknown) => { mock(status, body); try { await peexitVerify.resolve(idCM, ctx); return null; } catch (e) { return e as InstanceType<typeof IdentityError>; } };
    let e = await err(403, "<html>403 Forbidden</html>");
    ok("403 (IP allowlist / key) → AUTH_ERROR, not retryable", e?.code === "IDENTITY_PROVIDER_AUTH_ERROR" && e.retryable === false);
    e = await err(422, { error: { message: "unsupported country" } });
    ok("422 → UNSUPPORTED_COUNTRY, not retryable", e?.code === "IDENTITY_UNSUPPORTED_COUNTRY" && e.retryable === false);
    e = await err(503, { error: "down" });
    ok("5xx → PROVIDER_UNAVAILABLE, retryable (next provider may answer)", e?.code === "IDENTITY_PROVIDER_UNAVAILABLE" && e.retryable === true);
    globalThis.fetch = (async () => { const x = new Error("aborted"); x.name = "AbortError"; throw x; }) as typeof fetch;
    e = await peexitVerify.resolve(idCM, ctx).then(() => null, (x) => x as InstanceType<typeof IdentityError>);
    ok("a transport timeout → PROVIDER_TIMEOUT, retryable — never NOT_FOUND", e?.code === "IDENTITY_PROVIDER_TIMEOUT" && e.retryable === true);
    const h = await peexitVerify.health();
    ok("health names CM / MTN+ORANGE and never the key", h.configured && h.supports.countries.join() === "CM" && !JSON.stringify(h).includes("test-key"));
    ok("the chain now lists peexit_verify before the sandbox for CM × ORANGE", providerChain("CM", "ORANGE").map((p) => p.name).join() === "peexit_verify,sandbox", providerChain("CM", "ORANGE").map((p) => p.name).join());
    ok("…so the capability table says CM.ORANGE has identity resolution", capabilityConfig().CM.ORANGE.identity_resolution === true && capabilityConfig().CM.ORANGE.provider === "peexit_verify");
  } finally { globalThis.fetch = realFetch; (config.peexit as { apiKey: string }).apiKey = savedKey; }

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
  ok("every request is audited by hash, never by number", auditRows(20).every((a) => !/670123|620000/.test(JSON.stringify(a))) && auditRows(20).length >= 5);
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
    const pay2 = await signedJson("/payments", { quoteId: q2.body.id, recipient: { phone: "670124000", country: "CM", provider: "MTN", name: "Unresolved Person" } });
    ok("a payment to an UNRESOLVED recipient (provider timed out, nothing cached) is created exactly as before — no snapshot", pay2.status === 200 && !pay2.body.recipientIdentity);
    const p1 = await store().getPayment(pay.body.id);
    await signedJson(`/payments/${pay.body.id}/simulate`, {});
    let del = await store().getPayment(pay.body.id);
    for (let i = 0; i < 40 && del?.state !== "DELIVERED"; i++) { await new Promise((r) => setTimeout(r, 250)); del = await store().getPayment(pay.body.id); }
    ok("the V1 flow delivered it unchanged", del?.state === "DELIVERED");
    ok("the snapshot on the delivered payment is byte-identical to the one at creation (immutable)", JSON.stringify(del?.recipientIdentity) === JSON.stringify(p1?.recipientIdentity));
    ok("cachedSnapshot never calls a provider: an unknown number is simply null", cachedSnapshot("699999999", "CM") === null);
    void H;

    console.log("\nCache lifetimes, single-flight, gate mode, admin visibility\n");
    const { cached: cachedRec } = await import("../src/core/identityResolution/cache.js");
    const vRec = cachedRec(identifierHash("+237670123456")); const nfRec = cachedRec(identifierHash("+237670123459"));
    ok("a VERIFIED name holds for hours; NOT_FOUND for minutes", !!vRec && !!nfRec && Date.parse(vRec!.expiresAt) - Date.now() > 3_600_000 && Date.parse(nfRec!.expiresAt) - Date.now() <= 60_000 * 2, `${vRec?.expiresAt} / ${nfRec?.expiresAt}`);
    const before = metricsSnapshot().identity_resolution_cache_miss;
    const [s1, s2, s3] = await Promise.all([1, 2, 3].map((i) => resolveIdentity({ identifier: "670125456", purpose: "RECIPIENT_VERIFICATION", actor: `sf-${i}`, expectedName: i === 2 ? "Nobody Else" : undefined })));
    ok("three simultaneous lookups of one number make ONE provider call (single-flight)", metricsSnapshot().identity_resolution_cache_miss === before + 1 && s1.status === "VERIFIED" && s3.displayName === s1.displayName, `${metricsSnapshot().identity_resolution_cache_miss - before} misses`);
    ok("…and each caller still gets its own name verdict", s2.nameMatch === "NO_MATCH" && s1.nameMatch === "NOT_AVAILABLE");
    process.env.IDENTITY_RESOLUTION_MODE = "gate";
    // A number far from anything paid before (the near-miss guard is its own safeguard).
    await call("/v2/identity/resolve", "dev-1", { identifier: "699000159", purpose: "RECIPIENT_VERIFICATION" });
    const q4 = await signedJson("/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    const gated = await signedJson("/payments", { quoteId: q4.body.id, recipient: { phone: "699000159", country: "CM", provider: "ORANGE", name: "Some Body" } });
    ok("GATE mode: the server refuses a payment to an account the operator says is not there (409, cache-only)", gated.status === 409 && gated.body.error === "recipient_unverified" && gated.body.code === "identity_not_found", `${gated.status} ${JSON.stringify(gated.body)}`);
    const q5 = await signedJson("/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    const okPay = await signedJson("/payments", { quoteId: q5.body.id, recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "Nana Jean Paul" } });
    ok("…and still mints one to a verified account", okPay.status === 200 && okPay.body.recipientIdentity?.verified === true);
    const q6 = await signedJson("/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    const unk = await signedJson("/payments", { quoteId: q6.body.id, recipient: { phone: "699551000", country: "CM", provider: "ORANGE", name: "Never Looked Up" } });
    ok("…and an outage / never-resolved number is NOT a refusal even in gate mode", unk.status === 200 && !unk.body.recipientIdentity, String(unk.status));
    process.env.IDENTITY_RESOLUTION_MODE = "advisory";
    const adm = await fetch(`${base}/admin/identity-resolution`, { headers: A }).then((r) => r.json()) as Record<string, any>;
    ok("Admin → Identities sees flag, mode, chain order, provider health, metrics and hashed audit rows", adm.enabled === true && adm.mode === "advisory" && adm.priority[0] === "mtn_direct" && Array.isArray(adm.providers) && adm.metrics.identity_resolution_total > 0 && adm.audit.length > 0 && adm.audit.every((a: any) => !/670123|699000|670125/.test(JSON.stringify(a))) && adm.cache.ttlVerifiedSec >= adm.cache.ttlSec);
    const look = await fetch(`${base}/admin/identity-resolution/lookup`, { method: "POST", headers: { ...A, "content-type": "application/json" }, body: JSON.stringify({ identifier: "670123456", expectedName: "nana jean paul" }) }).then((r) => r.json()) as Record<string, any>;
    ok("a support lookup answers under purpose SUPPORT with the name verdict, bypassing the cache", look.status === "VERIFIED" && look.displayName === "NANA JEAN PAUL" && look.nameMatch === "MATCH" && look.source === "sandbox");
    ok("…and is audited under the admin, not a device", auditRows(3).some((a) => a.purpose === "SUPPORT" && a.actor.startsWith("admin:")));
    ok("the support lookup is unauthenticated-proof", (await fetch(`${base}/admin/identity-resolution/lookup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "670123456" }) })).status === 401);

    console.log("\nFlag off = V1 exactly\n");
    process.env.IDENTITY_RESOLUTION_ENABLED = "false";
    x = await call("/v2/identity/resolve", "dev-1", { identifier: "670123456", purpose: "RECIPIENT_VERIFICATION" });
    ok("the surface answers 404 with the flag off", x.status === 404);
    const cfg2 = await fetch(`${base}/config`).then((r) => r.json()) as Record<string, any>;
    ok("/config says off", cfg2.identity?.enabled === false);
    const admOff = await fetch(`${base}/admin/identity-resolution`, { headers: A }).then((r) => r.json()) as Record<string, any>;
    ok("the admin card still explains itself with the flag off", admOff.enabled === false && Array.isArray(admOff.providers));
    ok("…but the support lookup is closed (no side door)", (await fetch(`${base}/admin/identity-resolution/lookup`, { method: "POST", headers: { ...A, "content-type": "application/json" }, body: JSON.stringify({ identifier: "670123456" }) })).status === 404);
    const q3 = await signedJson("/quotes", { xaf: 5000, method: "LIGHTNING", country: "CM" });
    const pay3 = await signedJson("/payments", { quoteId: q3.body.id, recipient: { phone: "670123456", country: "CM", provider: "MTN", name: "Nana Jean Paul" } });
    ok("a payment created with the flag off carries no snapshot even though the cache has one", pay3.status === 200 && !pay3.body.recipientIdentity);
    process.env.IDENTITY_RESOLUTION_ENABLED = "true";
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
