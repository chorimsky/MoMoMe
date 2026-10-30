/* The peexit_verify provider, exercised end to end against a fake Peexit.
   Run: tsx test/identity-peexit-shapes.test.ts

   WHY THIS EXISTS. peexit_verify is the only fallback behind campay_holder for recipient
   verification in Cameroon, and in production it has never once been called: campay
   precedes it in the chain and always returns a terminal answer, so Admin → Identities has
   shown peexit_verify as UNKNOWN since the day it shipped. A fallback nobody has run is not
   redundancy. There is no safe way to exercise it against the real Peexit — the only
   authoritative call costs a real lookup against a real person's wallet — so this test
   points PEEXIT_API_URL at a local server that speaks Peexit's two documented shapes and
   its real failure bodies, and asserts what the sender is told in each case.

   The two shapes are not interchangeable: /clients/verify_wallet (deployed) returns
   { valid, accountTitle, accountStatus } and wants countryCode "cm"; /clients/verify-wallet
   (the sandbox docs) returns { isValid, accountName, status, operator } and wants "CM".
   The case is asserted per endpoint, because the second is reached only as a fallback and a
   wrong case there would fail silently until the day the first endpoint moves. */
import { createServer, type Server } from "node:http";

const PORT = 45_731;
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "peexit-shapes-test";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";
process.env.PEEXIT_API_URL = `http://127.0.0.1:${PORT}/api/v1`;
process.env.PEEXIT_API_KEY = "test-not-a-real-key";   // configured() only checks presence
process.env.PEEXIT_ENV = "sandbox";
delete process.env.PEEXIT_PROXY_URL;                   // never proxy a loopback fake

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

type Seen = { path: string; countryCode?: string; accountNumber?: string };
let seen: Seen[] = [];
/** What the fake answers next, per path. 404 route-missing bodies are LoopBack's real text. */
let reply: (path: string, body: Seen) => { code: number; json: unknown } = () => ({ code: 200, json: {} });

function serve(): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(raw || "{}") as Record<string, unknown>; } catch { /* keep {} */ }
        const path = (req.url ?? "").replace("/api/v1", "");
        const entry: Seen = { path, countryCode: parsed.countryCode as string | undefined, accountNumber: parsed.accountNumber as string | undefined };
        seen.push(entry);
        const r = reply(path, entry);
        res.writeHead(r.code, { "content-type": "application/json" });
        res.end(JSON.stringify(r.json));
      });
    });
    s.listen(PORT, "127.0.0.1", () => resolve(s));
  });
}

async function main() {
  const server = await serve();
  const { peexitVerify } = await import("../src/core/identityResolution/providers/peexit.js");
  const { normalizeMsisdn } = await import("../src/core/identityResolution/msisdn.js");

  const id = normalizeMsisdn("+237680344485", "CM");
  const ctx = { timeoutMs: 4000, purpose: "SEND" as const, bypassCache: true };
  type Answer = Awaited<ReturnType<typeof peexitVerify.resolve>>;
  const run = async (): Promise<{ a?: Answer; err?: { code?: string; detail?: string; retryable?: boolean } }> => {
    seen = [];
    try { return { a: await peexitVerify.resolve(id, ctx as never) }; }
    catch (e) { const x = e as { code?: string; detail?: string; retryable?: boolean }; return { err: x }; }
  };

  ok("configured with a key present", peexitVerify.configured() === true);
  ok("supports CM/MTN", peexitVerify.supports("CM", "MTN") === true);
  ok("supports CM/ORANGE", peexitVerify.supports("CM", "ORANGE") === true);
  ok("does not support KE/MPESA", peexitVerify.supports("KE", "MPESA") === false);

  console.log("\n  shape 1 — /clients/verify_wallet (the deployed one)\n");
  reply = () => ({ code: 200, json: { valid: true, accountTitle: "CHO RIMSKY", accountStatus: "ACTIVE", accountType: "MOBILE_MONEY" } });
  let r = await run();
  ok("a named ACTIVE wallet is VERIFIED", r.a?.status === "VERIFIED", r.a?.status);
  ok("…with the name Peexit gave", r.a?.displayName === "CHO RIMSKY", r.a?.displayName);
  ok("…reached verify_wallet first", seen[0]?.path === "/clients/verify_wallet", seen[0]?.path);
  ok("…with countryCode lowercase", seen[0]?.countryCode === "cm", seen[0]?.countryCode);
  ok("…and the national number, no +237", seen[0]?.accountNumber === "680344485", seen[0]?.accountNumber);
  ok("…and only one call was made", seen.length === 1, String(seen.length));

  reply = () => ({ code: 200, json: { valid: true, accountStatus: "ACTIVE" } });
  r = await run();
  ok("a reachable wallet whose name is withheld is UNKNOWN, not VERIFIED", r.a?.status === "UNKNOWN", r.a?.status);
  ok("…never carries a fabricated name", !r.a?.displayName, String(r.a?.displayName));
  ok("…and stays payable", r.a?.capabilities?.payout === true, String(r.a?.capabilities?.payout));

  reply = () => ({ code: 200, json: { valid: false, accountStatus: "SUSPENDED", accountTitle: "CHO RIMSKY" } });
  r = await run();
  ok("a suspended wallet is INACTIVE", r.a?.status === "INACTIVE", r.a?.status);
  ok("…and is not payable", r.a?.capabilities?.payout === false, String(r.a?.capabilities?.payout));

  reply = () => ({ code: 200, json: { valid: false } });
  r = await run();
  ok("valid:false with nothing else is NOT_FOUND", r.a?.status === "NOT_FOUND", r.a?.status);

  console.log("\n  an accountStatus we have never seen must not become INACTIVE\n");
  reply = () => ({ code: 200, json: { valid: true, accountStatus: "ENABLED" } });
  r = await run();
  ok("an unrecognised status is UNKNOWN", r.a?.status === "UNKNOWN", r.a?.status);
  ok("…not INACTIVE", r.a?.status !== "INACTIVE");
  ok("…and does not block the payment", r.a?.capabilities?.payout === true, String(r.a?.capabilities?.payout));
  const h = await peexitVerify.health();
  ok("…and the operator can see the actual string", /ENABLED/.test(h.lastError ?? ""), h.lastError);

  reply = () => ({ code: 200, json: { valid: true, accountTitle: "CHO RIMSKY", accountStatus: "Active" } });
  r = await run();
  ok("a lowercase 'Active' is still VERIFIED", r.a?.status === "VERIFIED", r.a?.status);

  console.log("\n  shape 2 — the fallback, reached only when the first route is missing\n");
  reply = (p) => p === "/clients/verify_wallet"
    ? { code: 404, json: { error: { statusCode: 404, message: "Endpoint \"POST /clients/verify_wallet\" not found." } } }
    : { code: 200, json: { isValid: true, accountName: "CHO RIMSKY", status: "ACTIVE", operator: "mtn" } };
  r = await run();
  ok("the fallback shape is read", r.a?.status === "VERIFIED", r.a?.status);
  ok("…its name field (accountName) is used", r.a?.displayName === "CHO RIMSKY", r.a?.displayName);
  ok("…its operator is normalised", r.a?.operator === "MTN", String(r.a?.operator));
  ok("…both routes were tried, in order", seen.map((x) => x.path).join(",") === "/clients/verify_wallet,/clients/verify-wallet", seen.map((x) => x.path).join(","));
  ok("…and the fallback got UPPERCASE countryCode", seen[1]?.countryCode === "CM", seen[1]?.countryCode);

  console.log("\n  a route-404 must never reach a sender as \"not found\"\n");
  reply = () => ({ code: 404, json: { error: { statusCode: 404, message: "Endpoint \"POST /clients/verify_wallet\" not found." } } });
  r = await run();
  ok("both routes missing is an outage, not an answer", r.err?.code === "IDENTITY_PROVIDER_UNAVAILABLE", r.err?.code ?? r.a?.status);
  ok("…and is NOT reported as NOT_FOUND", r.a?.status !== "NOT_FOUND");
  ok("…after trying both", seen.length === 2, String(seen.length));

  reply = () => ({ code: 404, json: { error: { message: "Account not found on the provider network" } } });
  r = await run();
  ok("Peexit's own account-404 IS an answer: NOT_FOUND", r.a?.status === "NOT_FOUND", r.err?.code ?? r.a?.status);
  ok("…and does not try the second route", seen.length === 1, String(seen.length));

  console.log("\n  the rest of Peexit's failure vocabulary\n");
  reply = () => ({ code: 403, json: { error: { message: "IP not allowed" } } });
  r = await run();
  ok("403 is an auth/allowlist error", r.err?.code === "IDENTITY_PROVIDER_AUTH_ERROR", r.err?.code);
  ok("…and is not retried (the allowlist will not change in 2s)", r.err?.retryable !== true, String(r.err?.retryable));

  reply = () => ({ code: 422, json: { error: { message: "country not supported" } } });
  r = await run();
  ok("422 is an unsupported country", r.err?.code === "IDENTITY_UNSUPPORTED_COUNTRY", r.err?.code);

  reply = () => ({ code: 500, json: { error: { message: "boom" } } });
  r = await run();
  ok("500 is a retryable outage", r.err?.code === "IDENTITY_PROVIDER_UNAVAILABLE" && r.err?.retryable === true, `${r.err?.code} retryable=${r.err?.retryable}`);

  reply = () => ({ code: 200, json: { something: "else" } });
  r = await run();
  ok("a 200 without any documented field is an outage, not a verification", r.err?.code === "IDENTITY_PROVIDER_UNAVAILABLE", r.err?.code ?? r.a?.status);

  console.log("\n  health reflects what actually happened\n");
  reply = () => ({ code: 200, json: { valid: true, accountTitle: "CHO RIMSKY", accountStatus: "ACTIVE" } });
  await run();
  const good = await peexitVerify.health();
  ok("after a success, successRate is 1", good.successRate === 1, String(good.successRate));
  ok("…latency is a real number", typeof good.latencyMs === "number", String(good.latencyMs));
  ok("…and it claims only CM/MTN/ORANGE", JSON.stringify(good.supports?.countries) === '["CM"]', JSON.stringify(good.supports?.countries));
  reply = () => ({ code: 500, json: { error: { message: "boom" } } });
  await run();
  const bad = await peexitVerify.health();
  ok("after a failure, status is DOWN", bad.status === "DOWN", bad.status);
  ok("…and the reason is recorded", !!bad.lastError, bad.lastError);

  server.close();
  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
