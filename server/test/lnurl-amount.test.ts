/* LUD-06 step 7: "LN WALLET Verifies that amount in provided invoice equals the amount
   previously specified by user."

   That word is EQUALS. We were rounding the payer's millisatoshis up to the next whole
   satoshi before minting, so a wallet that asked for 1 077 576 msat was handed an invoice
   for 1 078 000 msat and refused to pay it — Wallet of Satoshi among them. Measured against
   production on 2026-09-25: whole-sat amounts matched, every sub-sat amount was over by up
   to 999 msat.

   Worse, `minSendable` was itself a sub-sat figure. "Pay the minimum" is the one amount a
   wallet offers by default, and it was the one amount guaranteed to fail.

   These tests drive the real HTTP surface. The first would have failed before the fix.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/lnurl-amount.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/** Millisatoshis encoded in a bolt11's human-readable part. */
function invoiceMsat(bolt11: string): number {
  const m = /^lnbc(\d+)([munp]?)1/.exec(bolt11.toLowerCase());
  if (!m) throw new Error(`not a bolt11 amount: ${bolt11.slice(0, 24)}`);
  const mult: Record<string, number> = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, "": 1 };
  return Math.round(Number(m[1]) * mult[m[2]] * 1e8 * 1000);
}

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const NUMBER = "670000000";

  try {
    console.log("\nThe payRequest a wallet is shown\n");
    const pr = await (await fetch(`${base}/.well-known/lnurlp/${NUMBER}`)).json() as
      { tag?: string; callback?: string; minSendable?: number; maxSendable?: number; metadata?: string };
    ok("is a payRequest", pr.tag === "payRequest");
    ok("minSendable is a whole number of sats", pr.minSendable !== undefined && pr.minSendable % 1000 === 0, `${pr.minSendable} msat`);
    ok("maxSendable is a whole number of sats", pr.maxSendable !== undefined && pr.maxSendable % 1000 === 0, `${pr.maxSendable} msat`);
    ok("the range is not inverted", (pr.minSendable ?? 0) <= (pr.maxSendable ?? 0));

    console.log("\nThe invoice equals what the wallet asked for — LUD-06 step 7\n");
    const min = pr.minSendable!;
    // Sub-sat amounts either side of a boundary, plus the two a wallet reaches for by
    // default: the minimum, and a round number the user typed.
    const cases = [min, min + 1, min + 576, min + 999, min + 1000, min + 12_345, 2_000_000];
    for (const asked of cases) {
      if (asked > (pr.maxSendable ?? 0)) continue;
      const cb = await (await fetch(`${base}/lnurl/pay/${NUMBER}?amount=${asked}`)).json() as { pr?: string; reason?: string };
      if (!cb.pr) { ok(`${asked} msat → invoice`, false, cb.reason ?? "no pr"); continue; }
      const got = invoiceMsat(cb.pr);
      ok(`${asked} msat asked → ${got} msat invoiced`, got === asked, got === asked ? "equal" : `off by ${got - asked}`);
    }

    console.log("\n\"Pay the minimum\" — the default path, and the one that was broken\n");
    const atMin = await (await fetch(`${base}/lnurl/pay/${NUMBER}?amount=${min}`)).json() as { pr?: string };
    ok("minSendable itself mints an invoice", Boolean(atMin.pr));
    ok("…for exactly minSendable", Boolean(atMin.pr) && invoiceMsat(atMin.pr!) === min);

    console.log("\nOut-of-range amounts are still refused, not rounded into range\n");
    const below = await (await fetch(`${base}/lnurl/pay/${NUMBER}?amount=${min - 1}`)).json() as { status?: string; pr?: string };
    ok("one msat under the minimum is an LNURL error", below.status === "ERROR" && !below.pr);
    const above = await (await fetch(`${base}/lnurl/pay/${NUMBER}?amount=${(pr.maxSendable ?? 0) + 1}`)).json() as { status?: string; pr?: string };
    ok("one msat over the maximum is an LNURL error", above.status === "ERROR" && !above.pr);
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
