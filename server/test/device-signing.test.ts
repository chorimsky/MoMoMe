/* Device proof-of-possession, as the MOBILE app now does it (@noble/curves P-256, raw r||s)
   against the server's WebCrypto verifier — the two implementations must agree byte for
   byte, or every signed request from a phone is a 401.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox LEGACY_SENDER_UNTIL=2000-01-01T00:00:00Z tsx test/device-signing.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.LEGACY_SENDER_UNTIL = "2000-01-01T00:00:00Z"; // the migration window is OVER in this test

import type { AddressInfo } from "node:net";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
const b64url = (u8: Uint8Array) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwk = (priv: Uint8Array) => { const pub = p256.getPublicKey(priv, false); return { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) }; };
const sign = (priv: Uint8Array, method: string, path: string, body: string, ts = String(Date.now())) => {
  const msg = new TextEncoder().encode(`${method}\n${path}\n${ts}\n${b64(sha256(new TextEncoder().encode(body)))}`);
  return { ts, sig: b64(p256.sign(sha256(msg), priv, { prehash: false, lowS: true })) };
};

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = p256.utils.randomSecretKey(), wrap = p256.utils.randomSecretKey();
  const sid = "dev_mobile_test_1";
  try {
    console.log("\nDevice signing — mobile (@noble) ↔ server (WebCrypto)\n");
    const body0 = JSON.stringify({ token: "ExponentPushToken[abcdefgh12345678]", platform: "android", lang: "fr" });
    let r = await fetch(`${base}/api/me/push-token`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid }, body: body0 });
    ok("after the migration window an un-enrolled bare id is refused", r.status === 401, String(r.status));

    r = await fetch(`${base}/api/me/devices`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid }, body: JSON.stringify({ authPub: jwk(auth), wrapPub: jwk(wrap) }) });
    ok("enrolment with noble-derived JWKs is accepted", r.status === 200, String(r.status));

    r = await fetch(`${base}/api/me/push-token`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid }, body: body0 });
    ok("enrolled id WITHOUT a signature is refused", r.status === 401, String(r.status));

    let s = sign(auth, "GET", "/me/vault", "");
    r = await fetch(`${base}/api/me/vault`, { headers: { "x-mm-sender": sid, "x-mm-ts": s.ts, "x-mm-sig": s.sig } });
    ok("a noble P-256 raw r||s signature verifies on the server", r.status === 200, String(r.status));

    const body = JSON.stringify({ token: "ExponentPushToken[abcdefgh12345678]", platform: "android", lang: "fr" });
    s = sign(auth, "POST", "/me/push-token", body);
    r = await fetch(`${base}/api/me/push-token`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid, "x-mm-ts": s.ts, "x-mm-sig": s.sig }, body });
    ok("signed POST with a body verifies (body hash bound)", r.status === 200, String(r.status));

    s = sign(auth, "POST", "/me/push-token", body);
    r = await fetch(`${base}/api/me/push-token`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid, "x-mm-ts": s.ts, "x-mm-sig": s.sig }, body: JSON.stringify({ token: "ExponentPushToken[attacker00000000]", platform: "android", lang: "fr" }) });
    ok("…and a swapped body under the same signature is refused", r.status === 401, String(r.status));

    const other = p256.utils.randomSecretKey();
    s = sign(other, "POST", "/me/push-token", body0);
    r = await fetch(`${base}/api/me/push-token`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid, "x-mm-ts": s.ts, "x-mm-sig": s.sig }, body: body0 });
    ok("a signature from a different key is refused", r.status === 401, String(r.status));

    s = sign(auth, "POST", "/me/push-token", body0, String(Date.now() - 10 * 60_000));
    r = await fetch(`${base}/api/me/push-token`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid, "x-mm-ts": s.ts, "x-mm-sig": s.sig }, body: body0 });
    ok("a 10-minute-old signature is refused (replay window)", r.status === 401, String(r.status));

    // The spoof that motivated this: pointing someone else's alerts at your phone.
    r = await fetch(`${base}/api/me/push-token`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": sid }, body });
    ok("push-token registration with a bare (spoofable) id is refused", r.status === 401, String(r.status));
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
