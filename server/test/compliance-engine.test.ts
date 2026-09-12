/* Compliance engine — decisions BEFORE money moves, and their consequences.
   blocked → refused at creation (watchlist, velocity); review → created, pay-in accepted,
   settlement HOLDS; clear → straight through. Also: the router reports the same verdicts.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/compliance-engine.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = (sender: string) => ({ "content-type": "application/json", "x-mm-sender": sender });
  const quote = async (xaf: number, sender: string) => (await (await fetch(`${root}/quotes`, { method: "POST", headers: H(sender), body: JSON.stringify({ xaf, method: "LIGHTNING", country: "CM" }) })).json() as { id: string });
  const pay = async (xaf: number, phone: string, sender: string) => { const q = await quote(xaf, sender); const r = await fetch(`${root}/payments`, { method: "POST", headers: H(sender), body: JSON.stringify({ quoteId: q.id, recipient: { phone, country: "CM", provider: "MTN" } }) }); return { status: r.status, body: await r.json() as Record<string, unknown> }; };
  const settle = async (id: string, sender: string) => { await fetch(`${root}/payments/${id}/simulate`, { method: "POST", headers: H(sender) }); for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 100)); const p = await (await fetch(`${root}/payments/${id}`, { headers: H(sender) })).json() as { state: string; events: Array<{ note?: string }> }; if (["DELIVERED", "FAILED", "MANUAL_REVIEW"].includes(p.state)) return p; } return await (await fetch(`${root}/payments/${id}`, { headers: H(sender) })).json() as { state: string; events: Array<{ note?: string }> }; };

  try {
    console.log("\nCompliance engine — refuse, hold, or clear, before money moves\n");
    const base = getSettings().compliance;

    // Clear: nothing flagged, settles normally.
    let r = await pay(1000, "699000111", "dev-clear");
    ok("a clean payment is created", r.status === 200, String(r.status));
    ok("…with no compliance flags", !(r.body as { complianceFlags?: string[] }).complianceFlags);
    let p = await settle(String(r.body.id), "dev-clear");
    ok("…and delivers", p.state === "DELIVERED", p.state);

    // Watchlist hit → refused at creation, nothing minted.
    updateSettings({ compliance: { ...base, sanctionsList: ["677000598"] } });
    r = await pay(1000, "677000598", "dev-watch");
    ok("a watchlisted recipient is refused at creation (403 compliance_blocked)", r.status === 403 && r.body.error === "compliance_blocked", `${r.status} ${r.body.error}`);
    ok("…with a message that does not name the reason to the sender", !/watchlist|sanction/i.test(String(r.body.message)));
    updateSettings({ compliance: { ...base, sanctionsList: [] } });

    // CDD trigger → created, held for review at settlement.
    updateSettings({ compliance: { ...getSettings().compliance, cddThresholdXaf: 5000 } });
    r = await pay(6000, "699000111", "dev-cdd");
    ok("a CDD-trigger payment is created", r.status === 200, String(r.status));
    ok("…stamped with the flag", ((r.body as { complianceFlags?: string[] }).complianceFlags ?? []).some((f) => f.startsWith("cdd")), JSON.stringify((r.body as { complianceFlags?: string[] }).complianceFlags));
    p = await settle(String(r.body.id), "dev-cdd");
    ok("…and settlement HOLDS for review (money booked, not paid out)", p.state === "MANUAL_REVIEW" && p.events.some((e) => /compliance review/.test(e.note ?? "")), p.state);
    updateSettings({ compliance: { ...getSettings().compliance, cddThresholdXaf: base.cddThresholdXaf } });

    // Velocity: sender 24 h total.
    updateSettings({ compliance: { ...getSettings().compliance, velocity: { senderDayXaf: 10_000, recipientDayXaf: 0, senderHourCount: 0 } } });
    r = await pay(6000, "699000111", "dev-vel");
    ok("first payment under the sender's daily limit is created", r.status === 200, String(r.status));
    r = await pay(6000, "699000222", "dev-vel");
    ok("the one that would exceed the sender's 24 h total is refused", r.status === 403 && r.body.error === "compliance_blocked", String(r.status));
    r = await pay(2500, "699000222", "dev-vel");
    ok("a payment inside the limit but past 80% is created and flagged near-limit", r.status === 200 && ((r.body as { complianceFlags?: string[] }).complianceFlags ?? []).some((f) => f.startsWith("near limit")), JSON.stringify((r.body as { complianceFlags?: string[] }).complianceFlags));

    // Velocity: recipient 24 h total across senders.
    updateSettings({ compliance: { ...getSettings().compliance, velocity: { senderDayXaf: 0, recipientDayXaf: 3000, senderHourCount: 0 } } });
    r = await pay(2000, "699000333", "dev-a");
    ok("recipient limit: first sender's payment created", r.status === 200);
    r = await pay(2000, "699000333", "dev-b");
    ok("…a second sender pushing the recipient over 24 h total is refused", r.status === 403, String(r.status));

    // Velocity: count per hour.
    updateSettings({ compliance: { ...getSettings().compliance, velocity: { senderDayXaf: 0, recipientDayXaf: 0, senderHourCount: 2 } } });
    await pay(500, "690111000", "dev-c"); await pay(500, "691222000", "dev-c");
    r = await pay(500, "692333000", "dev-c");
    ok("the third payment in an hour is refused at a 2/h limit", r.status === 403, String(r.status));
    updateSettings({ compliance: base });

    // Router reports the same verdicts on routes.
    updateSettings({ compliance: { ...base, sanctionsList: ["677000598"] } });
    const v1 = `${root}/v1`;
    const it = await (await fetch(`${v1}/payment-intents`, { method: "POST", headers: H("dev-route"), body: JSON.stringify({ destination: "677000598", amount: 5000 }) })).json() as { id: string };
    const rt = await (await fetch(`${v1}/payment-intents/${it.id}/routes`, { method: "POST", headers: H("dev-route") })).json() as { routes: Array<{ viable: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> };
    ok("routing marks a watchlisted destination non-viable on the compliance check", rt.routes.every((x) => !x.viable && x.checks.some((c) => c.name === "compliance" && !c.ok)), rt.routes[0]?.checks.find((c) => c.name === "compliance")?.detail);
    updateSettings({ compliance: base });

    // Interface: identity and business verification answer from real records.
    const { engine } = await import("../src/core/interop/compliance.js");
    ok("verifyIdentity: unclaimed number is not verified", engine.verifyIdentity("699000111", "CM").verified === false);
    ok("verifyBusiness: unknown merchant code is not verified", engine.verifyBusiness("MOM-CM-999999").verified === false);
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
