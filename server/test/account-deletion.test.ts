/* Account and data deletion — a Google Play requirement, and a promise that must be exact.

   Play's Data Safety section cannot be completed by an app offering accounts unless the
   account and its data can be deleted, in the app and at a public URL. MoMo›Me had
   accounts — a device enrolment, a phone anchor, an end-to-end encrypted contact vault,
   referral attribution — and no way at all to delete any of it.

   Deletion here is deliberately PARTIAL, and the exactness is the point. Contacts, device
   keys and referral links go. Settled payment records stay, because anti-money-laundering
   law requires a money transmitter to retain them and the ledger is double-entry, so
   erasing one side would unbalance every counterparty's books. Google accepts that only
   when it is disclosed rather than quietly done — so the response has to SAY what it kept
   and why, and these tests hold it to that. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PUBLIC_URL = "https://example.test";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { store } = await import("../src/db/store.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const ME = "device-alice";
  const OTHER = "device-bob";
  const H = (who: string) => ({ "content-type": "application/json", "x-mm-sender": who });
  const post = async (p: string, who: string, b?: unknown) =>
    fetch(`${base}${p}`, { method: "POST", headers: H(who), body: b === undefined ? undefined : JSON.stringify(b) });
  const put = async (p: string, who: string, b: unknown) =>
    fetch(`${base}${p}`, { method: "PUT", headers: H(who), body: JSON.stringify(b) });
  const get = async (p: string, who: string) => fetch(`${base}${p}`, { headers: H(who) });

  try {
    console.log("\nAccount deletion — exact about what goes and what stays\n");

    /* ---- build a real account for two people ---- */
    for (const who of [ME, OTHER]) {
      for (const rid of ["c1", "c2"]) {
        await put(`/api/me/vault/${rid}`, who, { ciphertext: "AAAA", iv: "BBBB", v: 1 });
      }
    }
    const mine = await (await get("/api/me/vault", ME)).json() as any;
    ok("the vault holds this device's contacts", (mine.records ?? mine).length === 2, JSON.stringify(mine).slice(0, 60));

    // A payment sent by this device — the record law requires us to keep.
    const q = await (await post("/api/quotes", ME, { xaf: 5000, method: "LIGHTNING", country: "CM" })).json() as any;
    const pay = await (await post("/api/payments", ME, {
      quoteId: q.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "R" },
    })).json() as any;
    ok("a payment exists against this device", !!pay?.id, pay?.id ?? pay?.error);

    /* ---- delete ---- */
    const res = await post("/api/me/delete", ME);
    const out = await res.json() as any;
    ok("deletion succeeds for the device that owns the account", res.status === 200 && out.ok === true, String(res.status));
    ok("it reports the contacts it destroyed", out.deleted?.contacts === 2, String(out.deleted?.contacts));

    /* ---- the promise: gone ---- */
    const after = await (await get("/api/me/vault", ME)).json() as any;
    ok("the contacts are actually gone", ((after.records ?? after).length ?? 0) === 0, JSON.stringify(after).slice(0, 60));

    /* ---- the promise: someone else is untouched ---- */
    const bob = await (await get("/api/me/vault", OTHER)).json() as any;
    ok("another person's contacts are untouched", (bob.records ?? bob).length === 2, JSON.stringify(bob).slice(0, 60));

    /* ---- the promise: retention is honest, not silent ---- */
    ok("it reports keeping the payment record", out.retained?.payments >= 1, String(out.retained?.payments));
    ok("and states the legal reason rather than just doing it",
       /money.?laundering|law/i.test(out.retained?.reason ?? ""), (out.retained?.reason ?? "").slice(0, 60));

    const stillThere = pay?.id ? await store().getPayment(pay.id) : undefined;
    ok("the payment record itself survives — erasing it would unbalance the ledger", !!stillThere, stillThere?.state);

    // And the books still balance, which is the reason retention is not optional.
    const net = (await store().allEntries())
      .filter((e) => e.currency === "XAF")
      .reduce((n, e) => n + (e.direction === "debit" ? e.amount : -e.amount), 0);
    ok("XAF still nets to zero after a deletion", Math.abs(net) < 1e-6, String(net));

    /* ---- idempotent, and unauthenticated callers get nothing ---- */
    const again = await (await post("/api/me/delete", ME)).json() as any;
    ok("deleting twice is harmless", again.ok === true && again.deleted?.contacts === 0, String(again.deleted?.contacts));

    const anon = await fetch(`${base}/api/me/delete`, { method: "POST", headers: { "content-type": "application/json" } });
    ok("a caller with no device id is refused, not silently 'succeeded'", anon.status === 401, String(anon.status));

    /* ---- someone who no longer has the device can still ASK, and it is on record ---- */
    const ask = (b: unknown) => fetch(`${base}/api/me/delete-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const bad = await ask({ phone: "12", country: "CM" });
    ok("a request with an unusable number is refused", bad.status === 400, String(bad.status));

    const r1 = await ask({ phone: "+237 6 80 34 44 85", country: "CM", note: "I uninstalled the app" });
    const o1 = await r1.json() as any;
    ok("a request needs no device id and is accepted with a reference", r1.status === 200 && o1.ok === true && /^DR-[A-Z2-9]{6}$/.test(o1.ref), `${r1.status} ${o1.ref}`);

    const o2 = await (await ask({ phone: "680344485", country: "CM" })).json() as any;
    ok("asking again for the same number returns the same open case", o2.ref === o1.ref && o2.alreadyOpen === true, o2.ref);

    const { listDeletionRequests } = await import("../src/core/deletionRequests.js");
    const open = listDeletionRequests().filter((r) => !r.resolvedAt);
    ok("the request is on record for an operator, keyed by the canonical number", open.length === 1 && open[0].phone === "680344485", JSON.stringify(open[0]).slice(0, 90));

    const { listNotifications } = await import("../src/core/notifications.js");
    ok("and an operator was told, with the reference", listNotifications().some((n) => n.kind === "deletion_request" && n.body.includes(o1.ref)), "");
  } finally {
    server.close();
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
