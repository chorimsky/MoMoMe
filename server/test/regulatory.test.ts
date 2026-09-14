/* Regulatory reporting — one period, every body, from the books.
   BEAC Annexes I–III add up to the payments that settled; DGI figures follow the configured
   rates (VAT carved out of the fee, acompte IS on turnover ex-VAT); ANIF/COBAC summaries
   reflect the compliance record; a filing is pinned to the compliance chain and cannot be
   recorded twice; the ANIF register stays officer-confidential.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/regulatory.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const { getSettings, updateSettings } = await import("../src/core/settings.js");
  const treasury = await import("../src/core/treasury.js");
  const { vatOf } = await import("../src/core/regulatory.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const admin = createUser("reg-admin", "Str0ng-Passw0rd!x", "Super Admin" as never);
  const A = { "x-admin-token": issueToken({ uid: admin.id, role: "Super Admin" as never }).token, "content-type": "application/json" };
  const reader = createUser("reg-reader", "Str0ng-Passw0rd!x", "Read Only" as never);
  const R = { "x-admin-token": issueToken({ uid: reader.id, role: "Read Only" as never }).token };
  const H = (dev: string) => ({ "content-type": "application/json", "x-mm-sender": dev });
  const j = async (p: string, init?: RequestInit) => { const r = await fetch(`${base}${p}`, init); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, never> & Record<string, unknown> }; };
  const period = new Date().toISOString().slice(0, 7);

  try {
    console.log("\nRegulatory reporting — from the books\n");
    // The sandbox store carries seeded demo payments: every figure below is asserted as a
    // DELTA over the report taken before this test's own payments.
    const R0 = (await j(`/admin/regulatory?period=${period}`, { headers: A })).body as never as import("../../shared/types.js").RegulatoryReport;
    // Two settled payments this month: 15 000 and 600 000 — the CTR threshold is lowered to
    // 500 000 for the test (the real 5 000 000 exceeds the operator's single-payout cap).
    const comp0 = getSettings().compliance;
    updateSettings({ compliance: { ...comp0, ctrThresholdXaf: 500_000, cddThresholdXaf: 900_000 } }); // CDD would HOLD the payment at settlement; the CTR register is what this test is about
    const amounts = [15_000, 600_000];
    let fees = 0;
    for (const xaf of amounts) {
      const dev = `payer-${xaf}`;
      const q = (await j("/quotes", { method: "POST", headers: H(dev), body: JSON.stringify({ xaf, method: "LIGHTNING", country: "CM" }) })).body as { id: string; feeXaf: number };
      fees += q.feeXaf;
      const p = (await j("/payments", { method: "POST", headers: H(dev), body: JSON.stringify({ quoteId: q.id, recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "Alice Ngo" } }) })).body as { id: string; state: string };
      await j(`/payments/${p.id}/simulate`, { method: "POST", headers: H(dev), body: "{}" });
      let st = "";
      for (let i = 0; i < 80 && st !== "DELIVERED"; i++) { await new Promise((r) => setTimeout(r, 200)); st = ((await j(`/payments/${p.id}`, { headers: H(dev) })).body as { state: string }).state; }
      ok(`${xaf.toLocaleString("en")} XAF settles`, st === "DELIVERED", st);
    }
    // A sweep this month, marked sold with a 3 400 XAF realized gain.
    const entry = { id: "tw_reg1", at: new Date().toISOString(), rail: "lightning" as const, asset: "BTC" as const, amount: 0.01, destination: "x@y.com", by: "t", status: "sent" as const, referenceXaf: 360_000, customerXaf: 354_600 };
    treasury.seedWithdrawal(entry);
    await treasury.markSold("tw_reg1", 358_000, "cfo");

    const rep = (await j(`/admin/regulatory?period=${period}`, { headers: A })).body as never as import("../../shared/types.js").RegulatoryReport;
    ok("the report covers the requested period", rep.period === period, rep.period);

    /* ---- BEAC ---- */
    const b = rep.beac;
    const b0 = R0.beac.totals;
    ok("Annex I counts every settled inbound receipt", b.totals.inboundCount === b0.inboundCount + 2, `${b.totals.inboundCount} vs ${b0.inboundCount}+2`);
    ok("…in XAF, gross of fee (what the customer paid)", b.totals.inboundXaf === b0.inboundXaf + 615_000 + fees, `${b.totals.inboundXaf} vs ${b0.inboundXaf + 615_000 + fees}`);
    ok("…as BTC over Lightning", b.inbound.some((a) => a.asset === "BTC" && a.method === "LIGHTNING" && a.assetAmount > 0));
    ok("Annex II counts every wallet credit, net (what the recipient got)", b.totals.creditCount === b0.creditCount + 2 && b.totals.creditXaf === b0.creditXaf + 615_000, JSON.stringify(b.totals));
    ok("…by operator and country", b.credits.some((c) => c.provider === "MTN" && c.country === "CM"));
    ok("Annex III names the processing chain", b.partners.length >= 3 && b.partners.some((p) => p.name.startsWith("Peexit")) && b.partners.some((p) => p.name.startsWith("IBEX")));
    ok("repatriation evidence counts the sold sweep", b.repatriation.sweeps === 1 && b.repatriation.sold === 1 && b.repatriation.realizedXaf === 358_000, JSON.stringify(b.repatriation));

    /* ---- DGI ---- */
    const t = rep.tax, rates = getSettings().tax;
    ok("Cameroon defaults: VAT 19.25 % carved out, acompte 2.2 %, IS 33 %, levy 0.2 %", rates.vatRatePct === 19.25 && rates.feeIncludesVat && rates.turnoverAdvancePct === 2.2 && rates.corporateRatePct === 33 && rates.momoLevyPct === 0.2);
    const t0 = R0.tax;
    ok("fee revenue grew by the fees charged", t.feeRevenueXaf === t0.feeRevenueXaf + fees, `${t.feeRevenueXaf} vs ${t0.feeRevenueXaf}+${fees}`);
    const { vat, exVat } = vatOf(t.feeRevenueXaf, rates);
    ok("VAT is carved out of the fee (fee = ex-VAT × 1.1925)", t.vatXaf === Math.round(vat) && Math.abs(exVat * 1.1925 - t.feeRevenueXaf) < 0.01, `${t.vatXaf}`);
    ok("realized FX from the sold sweep is turnover too", t.realizedFxXaf === t0.realizedFxXaf + 3_400, String(t.realizedFxXaf));
    ok("turnover ex-VAT = fee ex-VAT + realized FX", t.turnoverExVatXaf === Math.round(exVat + t.realizedFxXaf), String(t.turnoverExVatXaf));
    ok("acompte IS = 2.2 % of turnover ex-VAT", t.turnoverAdvanceXaf === Math.round(t.turnoverExVatXaf * 0.022), String(t.turnoverAdvanceXaf));
    ok("mobile-money levy exposure = 0.2 % of delivered volume", t.momoLevyXaf === Math.round(t.volumeXaf * 0.002) && t.volumeXaf === t0.volumeXaf + 615_000, String(t.momoLevyXaf));
    ok("year-to-date IS estimate = 33 % of YTD turnover", t.ytd.corporateTaxEstimateXaf === Math.round(t.ytd.turnoverExVatXaf * 0.33));
    // VAT on top instead of carved out.
    updateSettings({ tax: { ...rates, feeIncludesVat: false } });
    const rep2 = (await j(`/admin/regulatory?period=${period}`, { headers: A })).body as never as import("../../shared/types.js").RegulatoryReport;
    ok("with VAT on top, VAT = fee × 19.25 % and the fee is the ex-VAT base", rep2.tax.vatXaf === Math.round(t.feeRevenueXaf * 0.1925) && rep2.tax.turnoverExVatXaf === Math.round(t.feeRevenueXaf + t.realizedFxXaf), `${rep2.tax.vatXaf}`);
    updateSettings({ tax: rates });

    /* ---- ANIF / COBAC ---- */
    ok("ANIF: the 600 000 XAF payment is on the CTR register", rep.anif.ctrCount >= 1 && rep.anif.ctrXaf >= 600_000, JSON.stringify({ n: rep.anif.ctrCount, x: rep.anif.ctrXaf }));
    ok("COBAC: the programme report carries thresholds, limits and an intact record", rep.cobac.thresholds.ctrXaf === 500_000 && rep.cobac.integrityOk && rep.cobac.ytd.payments === R0.cobac.ytd.payments + 2);
    updateSettings({ compliance: comp0 });

    /* ---- calendar ---- */
    const beacOb = rep.obligations.find((o) => o.kind === "beac_annexes")!;
    ok("BEAC declaration is due by the 5th of the following month", beacOb.status === "due" && /-05$/.test(beacOb.dueAt ?? ""), `${beacOb.status} ${beacOb.dueAt}`);
    const vatOb = rep.obligations.find((o) => o.kind === "dgi_vat")!;
    ok("VAT return is due by the 15th of the following month", vatOb.status === "due" && /-15$/.test(vatOb.dueAt ?? ""), `${vatOb.dueAt}`);
    ok("an STR obligation with nothing filed says so, not 'overdue'", rep.obligations.find((o) => o.kind === "anif_str")?.status === "nothing_to_file");

    /* ---- filing register ---- */
    const filed = await j("/admin/regulatory/file", { method: "POST", headers: A, body: JSON.stringify({ body: "BEAC", kind: "beac_annexes", period, reference: "BEAC/DGR/2026-0417" }) });
    ok("a filing is recorded with the body's reference", filed.status === 200 && (filed.body.filing as { reference: string }).reference === "BEAC/DGR/2026-0417", String(filed.status));
    const again = await j("/admin/regulatory/file", { method: "POST", headers: A, body: JSON.stringify({ body: "BEAC", kind: "beac_annexes", period }) });
    ok("…and cannot be recorded twice for the same period", again.status === 409, String(again.status));
    const rep3 = (await j(`/admin/regulatory?period=${period}`, { headers: A })).body as never as import("../../shared/types.js").RegulatoryReport;
    ok("the calendar now shows it filed", rep3.obligations.find((o) => o.kind === "beac_annexes")?.status === "filed");
    const comp = (await j("/admin/compliance", { headers: A })).body as { events: Array<{ action: string; detail?: string }>; metrics: { integrityOk: boolean } };
    ok("the filing is on the tamper-evident compliance chain", comp.events.some((e) => e.action === "REPORT_FILED" && /BEAC/.test(e.detail ?? "")) && comp.metrics.integrityOk);

    /* ---- confidentiality / roles ---- */
    const ro = await j(`/admin/regulatory?period=${period}`, { headers: R });
    ok("a read-only user gets the report without the STR entries", ro.status === 200 && (ro.body.anif as { strs: unknown[] }).strs.length === 0, String(ro.status));
    const roFile = await j("/admin/regulatory/file", { method: "POST", headers: { ...R, "content-type": "application/json" }, body: JSON.stringify({ body: "DGI", kind: "dgi_vat", period }) });
    ok("…and cannot record a filing", roFile.status === 403, String(roFile.status));
    const csv = await fetch(`${base}/admin/regulatory/export?period=${period}&body=BEAC`, { headers: A });
    const text = await csv.text();
    ok("the BEAC export is a sectioned CSV with all three annexes", csv.status === 200 && /# Annex I/.test(text) && /# Annex II/.test(text) && /# Annex III/.test(text));
    const dgi = await (await fetch(`${base}/admin/regulatory/export?period=${period}&body=DGI`, { headers: A })).text();
    ok("the DGI export carries the rates it was computed with", /vat_pct/.test(dgi) && /19.25/.test(dgi));
    ok("the ANIF export is refused to a read-only user", (await fetch(`${base}/admin/regulatory/export?period=${period}&body=ANIF`, { headers: R })).status === 403);
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
