/* ============================================================
   Egress proxy — a fixed IP for IP-allowlisted rails.

   Peexit production (server.peexit.com) authenticates on the SOURCE IP: it returns an
   nginx 403 to any non-allowlisted source REGARDLESS of the SECRETKEY. The settlement
   backend runs on Vercel serverless, which egresses from a large rotating pool, so there
   is no address to register — that is what silently broke every production payout when the
   backend moved off Railway.

   This service exists to be that address. It runs on Railway with a Static Outbound IP,
   the backend points PEEXIT_PROXY_URL at it, and Peexit allowlists the one stable address.

   TWO THINGS KEEP IT FROM BECOMING AN OPEN RELAY — an unauthenticated proxy on a public
   host is found and abused within hours, and this one would be abused FROM the address a
   payment provider trusts:
     1. Proxy-Authorization (Basic) is required on every request.
     2. The destination is allowlisted. Even with the credential, it will only reach the
        hosts in ALLOWED_HOSTS — so a leaked credential buys an attacker nothing but a
        tunnel to Peexit's own API, which still needs the SECRETKEY.

   No dependencies: Node stdlib only, so it deploys in seconds and has no supply chain.
   ============================================================ */
import http from "node:http";
import net from "node:net";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const USER = process.env.PROXY_USER || "";
const PASS = process.env.PROXY_PASS || "";
/** Hosts this proxy may reach. Anything else is refused even with a valid credential. */
const ALLOWED = (process.env.ALLOWED_HOSTS || "server.peexit.com")
  .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

if (!USER || !PASS) {
  console.error("REFUSING TO START: PROXY_USER and PROXY_PASS must both be set. An egress proxy without authentication is an open relay, and this one carries the IP a payment provider trusts.");
  process.exit(1);
}

const expected = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

/** Constant-time compare so the credential can't be recovered by timing the response. */
function authOk(header) {
  const got = Buffer.from(String(header || ""));
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

/** Host (no port) allowed? Exact match or a subdomain of an allowed host. */
function hostAllowed(hostport) {
  const host = String(hostport || "").split(":")[0].toLowerCase();
  return ALLOWED.some((a) => host === a || host.endsWith("." + a));
}

const server = http.createServer((req, res) => {
  // A plain path (not an absolute URI) is a direct request to us, not a proxy request.
  if (!/^https?:\/\//i.test(req.url || "")) {
    const ok = (req.url || "").startsWith("/healthz");
    res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { ok: true, allowed: ALLOWED } : { error: "this is a proxy, not an origin" }));
    return;
  }
  if (!authOk(req.headers["proxy-authorization"])) {
    res.writeHead(407, { "proxy-authenticate": 'Basic realm="egress"' });
    res.end();
    return;
  }
  let u;
  try { u = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
  if (!hostAllowed(u.host)) { console.warn(`[proxy] refused ${u.host}`); res.writeHead(403); res.end(); return; }

  const headers = { ...req.headers };
  delete headers["proxy-authorization"];
  const up = http.request(
    { host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers },
    (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); },
  );
  up.on("error", (e) => { console.error("[proxy] upstream error", e.message); if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
});

// https targets arrive as CONNECT tunnels — this is the path Peexit actually uses.
server.on("connect", (req, clientSocket, head) => {
  if (!authOk(req.headers["proxy-authorization"])) {
    clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="egress"\r\n\r\n');
    clientSocket.end();
    return;
  }
  if (!hostAllowed(req.url)) {
    console.warn(`[proxy] refused CONNECT ${req.url}`);
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.end();
    return;
  }
  const [host, port] = String(req.url).split(":");
  const upstream = net.connect(Number(port || 443), host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
});

server.listen(PORT, () => console.log(`egress proxy on :${PORT} — allowed hosts: ${ALLOWED.join(", ")}`));
