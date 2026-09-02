/* Egress-IP allowlist awareness.
   Peexit production authenticates on the SOURCE IP: it 403s any non-allowlisted source
   REGARDLESS of the SECRETKEY. Moving hosts silently changed our IP and every production
   payout failed, misreported as "insufficient_rail_balance". These assertions cover the
   states an operator has to be able to tell apart. Network-free (fetch is stubbed). */
process.env.DB_PATH = ":memory:";
process.env.EGRESS_CACHE_MS = "0";     // re-probe every call so drift is observable
process.env.EGRESS_ALLOWLISTED_IP = "";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

let ipify: string | null = "203.0.113.10";
let ifconfig: string | null = "203.0.113.10";
globalThis.fetch = (async (input: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const ip = url.includes("ipify") ? ipify : ifconfig;
  if (!ip) return new Response("nope", { status: 500 });
  return new Response(JSON.stringify({ ip }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function main() {
  console.log("\nEgress allowlist — states an operator must be able to distinguish");
  const { egressStatus } = await import("../src/core/egress.js");
  const { config } = await import("../src/config.js");

  // 1. No expected IP registered yet → tell the operator exactly what to register.
  let e = await egressStatus();
  ok("discovers the outbound IP", e.ip === "203.0.113.10", String(e.ip));
  ok("no EGRESS_ALLOWLISTED_IP → matches is null, not false", e.matches === null);
  ok("note names the IP AND the var to set", e.note.includes("203.0.113.10") && e.note.includes("EGRESS_ALLOWLISTED_IP"));

  // 2. Registered and agreeing → healthy.
  config.egress.allowlistedIp = "203.0.113.10";
  e = await egressStatus();
  ok("matching allowlist → matches true", e.matches === true);
  ok("healthy note", e.note.includes("matches the allowlisted address"));

  // 3. THE FAILURE: egress moved away from the allowlisted address.
  ipify = ifconfig = "198.51.100.7";
  e = await egressStatus();
  ok("drift detected → matches false", e.matches === false);
  ok("previousIp reported", e.previousIp === "203.0.113.10", String(e.previousIp));
  ok("note explains the 403 is IP-based, not credential-based",
     e.note.includes("MISMATCH") && e.note.includes("403") && e.note.includes("regardless of credentials"));

  // 4. Proxied. `ip` must now be the address the RAIL sees — i.e. the proxy's — because
  //    that is the one an operator registers. Reporting this platform's own address there
  //    would hand them the wrong value, which is the mistake this module exists to prevent.
  //    Here the proxy is unreachable (nothing is listening on proxy.example), which is the
  //    FIRST state an operator hits after configuring one: set, but not actually carrying
  //    traffic. It must be called out, not quietly reported as an IP.
  config.peexit.proxyUrl = "http://proxy.example:8080";
  e = await egressStatus();
  ok("proxied → flagged as proxied", e.proxied === true);
  ok("unreachable proxy → NO ip reported (never a wrong address to register)", e.ip === null, String(e.ip));
  ok("…and the note says the tunnel isn't carrying traffic",
    e.note.includes("did not answer") && e.note.includes("PEEXIT_PROXY_URL"), e.note.slice(0, 70));
  // directIp is whatever the platform currently resolves to (case 3 moved it) — the point
  // is that it is reported SEPARATELY from `ip`, so it can never be mistaken for the
  // address to register.
  ok("this platform's own IP is reported separately, never as the one to register",
    e.directIp !== null && e.directIp !== e.ip, `direct=${e.directIp} rail=${e.ip}`);
  ok("no false 'matching' while the proxy is down", e.matches === null);
  config.peexit.proxyUrl = "";

  // 5. Sources disagree → report UNKNOWN rather than an IP someone would go register.
  ipify = "198.51.100.7"; ifconfig = "203.0.113.99";
  e = await egressStatus();
  ok("disagreeing sources → ip null (never a wrong IP to register)", e.ip === null, String(e.ip));
  ok("matches null when ip unknown (unknown is not 'matching')", e.matches === null);

  // 6. One source down → still answers from the other.
  ipify = "198.51.100.7"; ifconfig = null;
  e = await egressStatus();
  ok("one echo service down → still resolves", e.ip === "198.51.100.7", String(e.ip));

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
