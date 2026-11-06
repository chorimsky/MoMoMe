/* `req.ip` must be the CALLER, not our own plumbing.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/trust-proxy.test.ts

   THE BUG THIS PINS. app.ts set `trust proxy` to 1 — "exactly one proxy in front" — so
   Express took the RIGHTMOST X-Forwarded-For entry as the client. Production has more than
   one hop, so req.ip was an internal address. Nothing errored. What stopped working:

     • every rateLimitMiddleware route (/api/rum, /lnurl/pay, /api/telemetry,
       /api/payments/:id/confirm, /api/momo/transfers, /api/merchant, vault writes)
     • the identity-enumeration guard in routes/identityV2.ts
     • the `ip` field on ~12 operator audit records in routes/platformAdmin.ts — operator
       actions attributed to infrastructure instead of to a person, in a system with
       ANIF/COBAC reporting duties

   Measured in production before the fix: 155 requests at a 60-per-5-minutes endpoint,
   75 of them with a constant X-Forwarded-For, zero 429s. /lnurl/pay/:user (30/min, long
   predating the change) behaved identically, so it was never one route's bug.

   The limiter is used here as the ORACLE for what req.ip resolved to, because that is how
   the bug was found and it tests the thing end to end rather than the helper alone: a
   CONSTANT resolved ip throttles, a VARYING one never does.

   The asymmetry in the last two cases is the whole point. A forged entry a client sends
   sits to the LEFT of the address the platform appends, so walking from the right reaches
   the truth first and stops. Trusting a hop COUNT instead would eventually walk past it. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "trust-proxy-test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { isInternalHop } = await import("../src/core/trustProxy.js");

  console.log("\n  internal hops — ours, to be skipped\n");
  for (const ip of ["127.0.0.1", "10.0.0.7", "192.168.1.1", "172.16.0.1", "172.31.255.254",
                    "169.254.1.1", "100.64.0.1", "100.127.255.255", "::1", "fd00::1", "fc00::2",
                    "fe80::1", "::ffff:10.0.0.9", "10.0.0.7:4000", "[fd00::1]", "fe80::1%eth0"]) {
    ok(`${ip} is internal`, isInternalHop(ip) === true);
  }

  console.log("\n  public addresses — a caller, to be kept\n");
  for (const ip of ["1.2.3.4", "203.0.113.7", "8.8.8.8", "172.32.0.1", "172.15.255.255",
                    "100.63.255.255", "100.128.0.1", "2001:4860:4860::8888", "::ffff:1.2.3.4"]) {
    ok(`${ip} is NOT internal`, isInternalHop(ip) === false, String(isInternalHop(ip)));
  }

  console.log("\n  malformed input is not internal (fail closed: an unknown hop is a caller)\n");
  for (const ip of ["", "   ", "not-an-ip", "999.1.1.1", "10.0.0", "1.2.3.4.5"]) {
    ok(`${JSON.stringify(ip)} is NOT internal`, isInternalHop(ip) === false, String(isInternalHop(ip)));
  }

  /* ---------- end to end, with the limiter as the oracle ---------- */
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  /** Hit the beacon (60 per 5 min) until a 429, or give up. Returns the request number that
   *  was throttled, or 0. */
  const throttleAt = async (xff: (i: number) => string, tries = 70): Promise<number> => {
    for (let i = 1; i <= tries; i++) {
      const r = await fetch(`${base}/api/rum`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": xff(i) },
        body: JSON.stringify({ path: "/send", ttfb: 10 }),
      });
      if (r.status === 429) return i;
    }
    return 0;
  };

  console.log("\n  one hop: the caller is the only entry\n");
  let at = await throttleAt(() => "198.51.100.10");
  ok("a constant caller is throttled", at > 0 && at <= 61, `429 at ${at}`);

  console.log("\n  two hops: an internal hop is appended after the caller\n");
  // This is the production shape, and the case that was broken: with `trust proxy = 1`
  // req.ip was the varying internal address, so the limit never applied.
  at = await throttleAt((i) => `198.51.100.11, 10.0.0.${(i % 250) + 1}`);
  ok("a constant caller behind a VARYING internal hop is still throttled", at > 0 && at <= 61, `429 at ${at}`);

  console.log("\n  three hops, both internal — however many we have\n");
  at = await throttleAt((i) => `198.51.100.12, 10.0.0.${(i % 200) + 1}, 172.16.${i % 200}.4`);
  ok("two internal hops are both skipped", at > 0 && at <= 61, `429 at ${at}`);

  console.log("\n  a forged entry cannot take the caller's place\n");
  // The client supplies the leftmost value; the platform appends the real address. Walking
  // from the right reaches the real one first, so the forgery is never read — which means
  // it also cannot be used to dodge a limit by rotating it.
  at = await throttleAt((i) => `10.0.0.${(i % 250) + 1}, 198.51.100.13, 10.0.0.5`);
  ok("rotating a forged LEFT entry does not escape the limit", at > 0 && at <= 61, `429 at ${at}`);

  console.log("\n  distinct callers are counted separately (the limit is per caller)\n");
  at = await throttleAt((i) => `198.51.${Math.floor(i / 2) % 250}.${(i % 250) + 1}, 10.0.0.9`, 65);
  ok("a varying CALLER is not throttled", at === 0, at ? `429 at ${at}` : "no 429 in 65");

  await new Promise<void>((r) => server.close(() => r()));
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
