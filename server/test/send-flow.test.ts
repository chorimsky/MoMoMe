/* The consumer send flow, over the real HTTP surface a phone talks to — and the guards on
   it, which are the point of this file.

   Driven by hand on 2026-10-23 and found working: device enrol → quote → payment → inbound
   → DELIVERED, 2.3 s from the sender paying to the recipient being paid. Three controls
   fired on the way, and two of them were asserted NOWHERE:

     • A riskToken is bound to the DEVICE that was warned. The wrong-person check is the
       only guard on a payment that cannot be reversed; a token that any caller could
       present would make it decorative. Covered here for the first time.

     • A payment is visible only to the device that made it — including to another ENROLLED
       device, not merely to an anonymous caller. 404 rather than 403, so the id space
       cannot be probed by watching which ids answer differently.

   Quote single-use is already covered on the /v1 surface (api-v1.test.ts) over the same
   core, so it is not repeated here.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/send-flow.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
const b64url = (u8: Uint8Array) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwk = (priv: Uint8Array) => { const pub = p256.getPublicKey(priv, false); return { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) }; };
const signReq = (priv: Uint8Array, method: string, path: string, body: string, ts = String(Date.now())) => {
  const msg = new TextEncoder().encode(`${method}\n${path}\n${ts}\n${b64(sha256(new TextEncoder().encode(body)))}`);
  return { ts, sig: b64(p256.sign(sha256(msg), priv, { prehash: false, lowS: true, extraEntropy: true })) };
};
type J = Record<string, never> & Record<string, unknown>;

async function main() {
  const { createApp } = await import("../src/app.js");
  const srv = createApp().listen(0);
  await new Promise<void>((r) => srv.once("listening", () => r()));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

  /** A phone: its own key pair and sender id, signing the way the app signs. */
  const device = (sid: string) => {
    const key = p256.utils.randomSecretKey();
    const call = async (p: string, body?: unknown, method = body ? "POST" : "GET", signed = true) => {
      const raw = body ? JSON.stringify(body) : "";
      const h: Record<string, string> = { "content-type": "application/json", "x-mm-sender": sid };
      if (signed) { const s = signReq(key, method, p.replace(/^\/api/, ""), raw); h["x-mm-ts"] = s.ts; h["x-mm-sig"] = s.sig; }
      const r = await fetch(`${base}${p}`, { method, headers: h, body: raw || undefined });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as J };
    };
    return { sid, key, call, enrol: () => call("/api/me/devices", { authPub: jwk(key), wrapPub: jwk(p256.utils.randomSecretKey()) }) };
  };

  const alice = device("dev_alice");
  const mallory = device("dev_mallory");

  try {
    console.log("\nTwo phones, each enrolled with its own key\n");
    ok("alice enrols", (await alice.enrol()).status === 200);
    ok("mallory enrols", (await mallory.enrol()).status === 200);

    console.log("\nThe wrong-person guard, on a payment that cannot be reversed\n");
    const q = await alice.call("/api/quotes", { xaf: 25000, method: "LIGHTNING", country: "CM" }, "POST", false);
    ok("a quote is minted", q.status === 200 && Boolean(q.body.id), String(q.status));
    const wrong = await alice.call("/api/payments", { quoteId: q.body.id, recipient: { phone: "677123456", country: "CM", provider: "MTN", name: "NANA JEAN PAUL" } });
    ok("a name that is not the operator's record is REFUSED", wrong.status === 409 && wrong.body.code === "name_mismatch", `${wrong.status} ${String(wrong.body.code)}`);
    ok("…naming who the number actually belongs to", typeof wrong.body.operatorName === "string" && wrong.body.operatorName.length > 0, String(wrong.body.operatorName));
    ok("…and saying the payment cannot be reversed", /cannot be reversed/i.test(String(wrong.body.message)));
    ok("…with a token to acknowledge it deliberately", typeof wrong.body.riskToken === "string");

    console.log("\nTHE CONTROL: that token belongs to the device that was warned\n");
    const token = wrong.body.riskToken as string;
    const anon = await alice.call("/api/payments", { quoteId: q.body.id, riskToken: token, recipient: { phone: "677123456", country: "CM", provider: "MTN", name: "NANA JEAN PAUL" } }, "POST", false);
    ok("an UNSIGNED caller cannot use it", anon.status === 401, `${anon.status} ${String(anon.body.error)}`);
    const stolen = await mallory.call("/api/payments", { quoteId: q.body.id, riskToken: token, recipient: { phone: "677123456", country: "CM", provider: "MTN", name: "NANA JEAN PAUL" } });
    // Precisely: mallory is given her OWN warning, not passage. `!== 200` would also have
    // been satisfied by a 500, which is not the same thing as the control working.
    ok("another ENROLLED device cannot use it either — it is alice's warning, not a password",
      stolen.status === 409 && stolen.body.code === "name_mismatch",
      `${stolen.status} ${String(stolen.body.code ?? stolen.body.error ?? "")}`);
    ok("…and the token she is handed is a different one", typeof stolen.body.riskToken === "string" && stolen.body.riskToken !== token);

    console.log("\nThe ordinary path: the name the operator holds\n");
    const q2 = await alice.call("/api/quotes", { xaf: 25000, method: "LIGHTNING", country: "CM" }, "POST", false);
    const pay = await alice.call("/api/payments", { quoteId: q2.body.id, recipient: { phone: "677123456", country: "CM", provider: "MTN", name: wrong.body.operatorName } });
    ok("the payment is created", pay.status === 200 && pay.body.state === "AWAITING_INBOUND", `${pay.status} ${String(pay.body.state)}`);
    ok("…with an invoice for the sender to pay", /^lnbc/i.test(String((pay.body.payInstruction as J)?.code ?? "")));
    ok("…addressed to the operator's own name for the number", (pay.body.recipient as J)?.name === wrong.body.operatorName);

    console.log("\nInbound → payout → delivered\n");
    const id = pay.body.id as string;
    ok("the sender pays the invoice", (await alice.call(`/api/payments/${id}/simulate`, {})).status === 200);
    let cur: J = {}; const seen: string[] = [];
    for (let i = 0; i < 150; i++) {
      cur = (await alice.call(`/api/payments/${id}`)).body;
      const st = String(cur.state);
      if (!seen.includes(st)) seen.push(st);
      if (["DELIVERED", "FAILED", "REFUND_PENDING", "MANUAL_REVIEW"].includes(st)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    ok("it reaches DELIVERED", cur.state === "DELIVERED", `${String(cur.state)} · ${seen.join(" → ")}`);
    ok("…for the amount quoted, on the recipient's network", cur.xaf === 25000 && (cur.recipient as J)?.provider === "MTN");
    ok("…and says so to a person, not in engine vocabulary", cur.displayStatus === "Completed", String(cur.displayStatus));
    ok("…carrying the rail's own reference for support", typeof cur.payoutRef === "string" && String(cur.payoutRef).length > 0);

    console.log("\nTHE CONTROL: whose payment is it\n");
    ok("alice can read her own payment", (await alice.call(`/api/payments/${id}`)).status === 200);
    const byMallory = await mallory.call(`/api/payments/${id}`);
    ok("another enrolled device CANNOT read it", byMallory.status === 404, String(byMallory.status));
    ok("…answered 404, not 403 — a 403 would confirm the id exists", byMallory.body.error === "no_payment", String(byMallory.body.error));
    const unsigned = await alice.call(`/api/payments/${id}`, undefined, "GET", false);
    ok("and an unsigned read of it is refused too", unsigned.status !== 200, String(unsigned.status));
    ok("an id that never existed answers identically — nothing to probe",
      (await mallory.call("/api/payments/pay_does_not_exist")).status === 404);
  } finally { srv.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
