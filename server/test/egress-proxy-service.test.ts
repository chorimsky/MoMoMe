/* The egress proxy SERVICE, exercised by the real client.

   services/egress-proxy is what gives Peexit one stable address to allowlist. It only earns
   that trust if it is not an open relay: it sits on a public host, and anything it forwards
   arrives at Peexit from the address they trust. So the assertions here are as much about
   what it REFUSES as what it carries — and they run against the actual fetchT path the
   Peexit adapter uses, not a mock of it. */
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fetchT } from "../src/adapters/http.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("\nEgress proxy service — a fixed IP that is not an open relay");

  // Stand-in for server.peexit.com, and for an unrelated host the proxy must refuse.
  const origin = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, seenHeader: req.headers["secretkey"] ?? null }));
  });
  await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
  const originPort = (origin.address() as net.AddressInfo).port;

  const PORT = 18099;
  let proc: ChildProcess | null = null;
  try {
    proc = spawn(process.execPath, ["server.js"], {
      cwd: new URL("../../services/egress-proxy/", import.meta.url).pathname,
      env: { ...process.env, PORT: String(PORT), PROXY_USER: "u", PROXY_PASS: "p",
             // 127.0.0.1 stands in for server.peexit.com; example.invalid must be refused.
             ALLOWED_HOSTS: "127.0.0.1" },
      stdio: "ignore",
    });
    for (let i = 0; i < 40 && !(await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.ok).catch(() => false)); i++) await wait(150);

    const proxyUrl = `http://u:p@127.0.0.1:${PORT}`;
    const target = `http://127.0.0.1:${originPort}/disbursement/request_payment`;

    // 1. Health — so Railway can tell the service is up.
    const health = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json()) as { ok?: boolean; allowed?: string[] };
    ok("answers a health check", health.ok === true);
    ok("…and reports what it will reach", Array.isArray(health.allowed) && health.allowed.includes("127.0.0.1"), JSON.stringify(health.allowed));

    // 2. The real path: the Peexit adapter's own fetchT, through the proxy.
    const res = await fetchT(target, { headers: { SECRETKEY: "k" } }, 10_000, proxyUrl);
    ok("carries a Peexit-shaped call through", res.status === 200, String(res.status));
    const body = await res.json() as { ok?: boolean; seenHeader?: string | null };
    ok("SECRETKEY survives the hop", body.seenHeader === "k", String(body.seenHeader));

    // 3. NOT AN OPEN RELAY. Both of these would otherwise let a stranger send traffic from
    //    the address Peexit trusts.
    let unauth = 0;
    try { const r = await fetchT(target, {}, 8_000, `http://127.0.0.1:${PORT}`); unauth = r.status; }
    catch { unauth = -1; }
    ok("without a credential it refuses (407, or the client rejects)", unauth === 407 || unauth === -1, String(unauth));

    let wrongPass = 0;
    try { const r = await fetchT(target, {}, 8_000, `http://u:WRONG@127.0.0.1:${PORT}`); wrongPass = r.status; }
    catch { wrongPass = -1; }
    ok("a wrong password refuses", wrongPass === 407 || wrongPass === -1, String(wrongPass));

    // 4. DESTINATION LOCK — the part that makes a leaked credential nearly worthless.
    let offHost = 0;
    try { const r = await fetchT("http://example.invalid/x", {}, 8_000, proxyUrl); offHost = r.status; }
    catch { offHost = -1; }
    ok("a host outside ALLOWED_HOSTS is refused even WITH the credential", offHost === 403 || offHost === -1, String(offHost));

    // 5. It is a proxy, not an origin — a stray direct request shouldn't look like a service.
    const direct = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.status);
    ok("a non-proxy request is rejected, not served", direct === 400, String(direct));
  } finally {
    proc?.kill();
    origin.close();
  }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
