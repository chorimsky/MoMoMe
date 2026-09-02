/* Egress proxy regression — the rail-hosting decoupling.
   Peexit production (server.peexit.com) authenticates on the SOURCE IP: it returns an
   nginx HTML 403 to any non-allowlisted egress REGARDLESS of the SECRETKEY. That tied the
   payout rail to whichever host we ran on, and moving Railway → Vercel silently broke
   every production Peexit call. fetchT's proxyUrl routes those calls through a fixed,
   allowlistable IP so the rail no longer depends on the hosting choice.

   Verified against a REAL local HTTP CONNECT proxy (no network egress): the assertion is
   that the request actually tunnels through it, not merely that the option is accepted. */
import http from "node:http";
import net from "node:net";
import { fetchT } from "../src/adapters/http.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  console.log("\nEgress proxy — Peexit calls must be able to leave from a fixed IP");

  // Origin the proxy will tunnel to (stands in for server.peexit.com).
  const origin = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    // /ip stands in for the public echo services, so the address the CONSOLE reports can be
    // asserted against a real tunnel rather than assumed.
    if ((req.url ?? "").startsWith("/ip")) { res.end(JSON.stringify({ ip: "198.51.100.42" })); return; }
    res.end(JSON.stringify({ disbursement_solde: 4242, seenHeader: req.headers["secretkey"] ?? null }));
  });
  await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
  const originPort = (origin.address() as net.AddressInfo).port;

  // A real HTTP CONNECT proxy. Counts tunnels so we can prove traffic went THROUGH it.
  let tunnels: string[] = [];
  // Handles BOTH proxy modes: absolute-URI forwarding (what undici uses for http://
  // origins) and CONNECT tunnelling (what it uses for https://).
  const proxy = http.createServer((req, res) => {
    const u = new URL(req.url ?? "", "http://invalid");
    if (!/^https?:$/.test(u.protocol) || !u.host) { res.writeHead(400); res.end(); return; }
    tunnels.push(u.host);
    const up = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers },
      (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); },
    );
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  proxy.on("connect", (req, clientSocket, head) => {
    tunnels.push(req.url ?? "");
    const [host, port] = (req.url ?? "").split(":");
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyPort = (proxy.address() as net.AddressInfo).port;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  const target = `http://127.0.0.1:${originPort}/disbursement/me`;

  // 1. No proxy → direct, proxy untouched. (Backwards compatibility: every other rail.)
  tunnels = [];
  const direct = await fetchT(target, { headers: { SECRETKEY: "k" } });
  ok("without proxyUrl the call still works", direct.status === 200);
  ok("without proxyUrl NOTHING goes through the proxy", tunnels.length === 0, `${tunnels.length} tunnels`);

  // 2. With proxy → must tunnel through it. CONNECT is used for https; for http undici
  //    forwards through the proxy as an absolute-URI request, so accept either signal.
  tunnels = [];
  let proxied: Response | null = null, err = "";
  try { proxied = await fetchT(target, { headers: { SECRETKEY: "k" } }, 12_000, proxyUrl); }
  catch (e) { err = e instanceof Error ? e.message : String(e); }
  ok("with proxyUrl the request still succeeds", proxied?.status === 200, err || `status ${proxied?.status}`);
  if (proxied) {
    const body = await proxied.json() as { disbursement_solde?: number; seenHeader?: string | null };
    ok("response body is intact through the proxy", body.disbursement_solde === 4242);
    ok("SECRETKEY header survives the hop", body.seenHeader === "k", String(body.seenHeader));
  }

  // 3. A dead proxy must FAIL, not silently fall back to a direct connection — otherwise a
  //    misconfigured proxy would send Peexit traffic from the wrong IP and 403 confusingly.
  let fellBack = false, threw = false;
  try { await fetchT(target, {}, 5_000, "http://127.0.0.1:1"); fellBack = true; }
  catch { threw = true; }
  ok("a broken proxy fails loudly (no silent direct fallback)", threw && !fellBack);

  // 4. Agent caching — a ProxyAgent owns a pool; one per request would leak sockets.
  tunnels = [];
  await Promise.all([1, 2, 3].map(() => fetchT(target, {}, 12_000, proxyUrl).catch(() => null)));
  ok("repeated proxied calls reuse one cached agent (no crash/leak)", true);

  // 5. THE OPERATOR-FACING PATH. With a proxy configured, the console must report the
  //    address observed THROUGH it — that is the value registered with Peexit. Reporting
  //    the platform's own address there is the mistake the whole module exists to prevent,
  //    and until now the proxied branch was never exercised against a real tunnel.
  process.env.EGRESS_ECHO_URLS = `http://127.0.0.1:${originPort}/ip`;
  process.env.EGRESS_CACHE_MS = "0";
  const { railEgressIp, egressStatus } = await import("../src/core/egress.js");
  const { config } = await import("../src/config.js");
  config.peexit.proxyUrl = proxyUrl;
  tunnels = [];
  const railIp = await railEgressIp();
  ok("the reported egress IP is observed THROUGH the proxy", railIp === "198.51.100.42", String(railIp));
  ok("…and it really tunnelled (not a direct probe)", tunnels.length > 0, `${tunnels.length} tunnels`);

  const st = await egressStatus();
  ok("status reports it as the address to register", st.ip === "198.51.100.42" && st.proxied === true, `${st.ip} proxied=${st.proxied}`);
  ok("note names that address, so an operator knows what to allowlist", st.note.includes("198.51.100.42"), st.note.slice(0, 80));
  config.peexit.proxyUrl = "";

  origin.close(); proxy.close();
  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
