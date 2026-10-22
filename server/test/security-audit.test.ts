/* End-to-end security audit regressions (2026-09-22). Each case is a hole that was open:
     • a signed device request could be REPLAYED for the whole ±5-minute skew window;
     • a webhook URL whose HOSTNAME resolves to a private address passed validation, and
       delivery followed redirects straight past the host checks;
     • changing an admin password left every other session of that account valid for the
       rest of its 12-hour life;
     • CORS allowed localhost on a live-money deployment.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/security-audit.test.ts */
process.env.DB_PATH = ":memory:"; process.env.RAILS_MODE = "sandbox";
import { webcrypto } from "node:crypto";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { isPrivateAddress, validCallbackUrl } = await import("../src/core/interop/outbound.js");
  const server = createApp().listen(0); await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    console.log("\n1. A signed request is single-use\n");
    // Enrol a device, then sign one POST and send the exact bytes twice.
    const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const authPub = await webcrypto.subtle.exportKey("jwk", kp.publicKey);
    const dev = "replay-device";
    let r = await fetch(`${root}/api/me/devices`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": dev }, body: JSON.stringify({ authPub, wrapPub: authPub }) });
    ok("the device enrols", r.ok, String(r.status));

    const signed = async (method: string, path: string, body: string) => {
      const ts = String(Date.now());
      const hash = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(body))).toString("base64");
      const msg = new TextEncoder().encode(`${method}\n${path}\n${ts}\n${hash}`);
      const sig = Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, msg)).toString("base64");
      return { "content-type": "application/json", "x-mm-sender": dev, "x-mm-ts": ts, "x-mm-sig": sig };
    };
    const body = JSON.stringify({ businessName: "Replay Test", category: "Restaurant", country: "CM", settlementPhone: "677000901" });
    const headers = await signed("POST", "/merchant", body);
    const first = await fetch(`${root}/api/merchant`, { method: "POST", headers, body });
    ok("the first signed write is accepted", first.status === 201 || first.status === 200, String(first.status));
    const replay = await fetch(`${root}/api/merchant`, { method: "POST", headers, body });
    ok("…the SAME signature replayed is refused", replay.status === 401, String(replay.status));

    // A read is idempotent, so its signature may be reused — the client retries GETs freely.
    const gh = await signed("GET", "/merchant/me", "");
    const g1 = await fetch(`${root}/api/merchant/me`, { headers: gh });
    const g2 = await fetch(`${root}/api/merchant/me`, { headers: gh });
    ok("a signed READ can be repeated (retries must not break)", g1.status === g2.status && g1.status !== 401, `${g1.status}/${g2.status}`);

    console.log("\n2. Webhook endpoints cannot be pointed inward (SSRF)\n");
    ok("cloud metadata is a private address", isPrivateAddress("169.254.169.254"));
    ok("RFC1918, loopback, CGNAT and IPv6 unique-local too",
      isPrivateAddress("10.1.2.3") && isPrivateAddress("172.16.0.1") && isPrivateAddress("192.168.1.1")
      && isPrivateAddress("127.0.0.1") && isPrivateAddress("100.64.0.1") && isPrivateAddress("fd00::1") && isPrivateAddress("::1"));
    ok("a public address is not flagged", !isPrivateAddress("1.1.1.1") && !isPrivateAddress("2606:4700::1111"));
    ok("a literal private IP is still refused at subscribe time", !!validCallbackUrl("https://169.254.169.254/hook"));
    ok("http is refused", !!validCallbackUrl("http://example.com/hook"));
    ok("credentials in the URL are refused", !!validCallbackUrl("https://user:pw@example.com/hook"));
    ok("a public https endpoint is accepted", validCallbackUrl("https://example.com/hook") === null);

    console.log("\n3. An admin password change ends other sessions\n");
    const login = await fetch(`${root}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "momome-admin" }) });
    const { token } = await login.json() as { token: string };
    ok("the seeded operator can sign in", !!token);
    const auth = (t: string) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });
    ok("…and the token works", (await fetch(`${root}/api/admin/users`, { headers: auth(token) })).status === 200);
    const chg = await fetch(`${root}/api/admin/password`, { method: "POST", headers: auth(token), body: JSON.stringify({ currentPassword: "momome-admin", newPassword: "N3w-Passw0rd-Str0ng!" }) });
    const chgBody = await chg.json() as { ok?: boolean; token?: string };
    ok("the password change succeeds", chg.status === 200 && chgBody.ok === true, String(chg.status));
    ok("…and hands the operator a fresh token", typeof chgBody.token === "string" && chgBody.token !== token);
    const stale = await fetch(`${root}/api/admin/users`, { headers: auth(token) });
    ok("…while the OLD token is dead immediately", stale.status === 401, String(stale.status));
    ok("…and the new one works", (await fetch(`${root}/api/admin/users`, { headers: auth(chgBody.token!) })).status === 200);

    console.log("\n4. Cross-origin policy\n");
    const cors = await fetch(`${root}/api/config`, { headers: { origin: "https://momome-evil.vercel.app" } });
    ok("a look-alike Vercel origin is not allowed", !cors.headers.get("access-control-allow-origin"));
    const own = await fetch(`${root}/api/config`, { headers: { origin: "https://www.momome.xyz" } });
    ok("our own origin is", own.headers.get("access-control-allow-origin") === "https://www.momome.xyz");
  } finally { server.close(); }
  console.log("\nA partner's timeline must not republish our suppliers' text\n");
  {
    const { _publicDetail } = await import("../src/publicApi/account.js") as unknown as { _publicDetail?: (n?: string) => string | undefined };
    const detail = _publicDetail;
    if (!detail) { ok("account.ts exports its timeline filter for this test", false, "add `export { publicDetail as _publicDetail }`"); }
    else {
      // The exact strings our own code writes into a payment's events.
      ok("a provider's raw error body is NOT passed through",
        detail("payout failed at provider: MTN collection failed: 500 {\"err\":\"internal\"}") === "the provider rejected the payout"
        || detail("payout failed at provider: MTN collection failed: 500 {\"err\":\"internal\"}") === undefined);
      for (const note of [
        "MTN collection failed: 500 {\"detail\":\"upstream broke\"}",
        "CamPay withdrawal failed: 400 {\"errorcode\":\"ER999\"}",
        "Peexit disbursement failed: 403 <html>nginx</html>",
        "something nobody has written yet",
      ]) {
        const out = detail(note);
        ok(`"${note.slice(0, 34)}…" never reaches a partner verbatim`, out !== note, String(out));
        ok("…and no provider name leaks through it", !/mtn|campay|peexit|orange|pawapay/i.test(out ?? ""), String(out));
      }
      ok("an unrecognised note is OMITTED, not passed through — a deny-list would leak tomorrow's",
        detail("a brand new note nobody mapped") === undefined);
      ok("a note we DO recognise is still explained, in our own words",
        detail("payout failed at peexit (rejected) → retrying on campay") === "the first payout attempt failed; a second was made");
      ok("…without naming either rail", !/peexit|campay/i.test(detail("payout failed at peexit (rejected) → retrying on campay") ?? ""));
    }
  }

  console.log("\nCaller-supplied metadata is made to match the type that claims it\n");
  {
    const { cleanMetadata } = await import("../src/publicApi/connect.js");
    ok("a normal map survives", JSON.stringify(cleanMetadata({ order: "A-1", note: "ok" })) === '{"order":"A-1","note":"ok"}');
    ok("a non-object is refused", cleanMetadata("nope") === undefined && cleanMetadata(42) === undefined);
    ok("an ARRAY is refused — the type says map", cleanMetadata(["a", "b"]) === undefined);
    ok("null and undefined are refused", cleanMetadata(null) === undefined && cleanMetadata(undefined) === undefined);

    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, "v"]));
    ok("a 500-key object is capped at 50", Object.keys(cleanMetadata(wide) ?? {}).length === 50);
    const long = cleanMetadata({ note: "x".repeat(5_000) })!;
    ok("an over-long value is truncated, not refused — a long note must not kill a payment",
      long.note.length === 500);
    ok("an over-long KEY is dropped", cleanMetadata({ ["k".repeat(200)]: "v", ok: "1" })?.["ok"] === "1"
      && Object.keys(cleanMetadata({ ["k".repeat(200)]: "v", ok: "1" }) ?? {}).length === 1);

    // The type promised Record<string,string>; the cast delivered whatever arrived.
    const nested = cleanMetadata({ deep: { a: { b: [1, 2, 3] } }, n: 7, t: true })!;
    ok("every value really IS a string now", Object.values(nested).every((v) => typeof v === "string"), JSON.stringify(nested));
    ok("…a nested object is summarised, not stored as structure", nested.deep.startsWith("{"));
    ok("…and numbers and booleans are stringified", nested.n === "7" && nested.t === "true");

    const poison = JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"x":1},"safe":"1"}');
    const cleaned = cleanMetadata(poison)!;
    // Object.hasOwn, not `in`: "constructor" is in EVERY object via the prototype chain,
    // so `in` would have failed this assertion against correct code.
    ok("keys that could shadow object internals are dropped",
      !Object.hasOwn(cleaned, "__proto__") && !Object.hasOwn(cleaned, "constructor") && cleaned.safe === "1", JSON.stringify(cleaned));
    ok("…and nothing was polluted along the way", ({} as Record<string, unknown>).polluted === undefined);
  }

  console.log("\nIds that could become capabilities are not predictable\n");
  {
    const { id } = await import("../src/core/ids.js");
    const made = Array.from({ length: 200 }, () => id("t"));
    ok("every id is unique across 200", new Set(made).size === 200);
    ok("…and the random part is not Math.random's base36 alphabet only", made.every((x) => /^t_[a-z0-9]+[0-9a-f]{6}$/.test(x)), made[0]);
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`); process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
