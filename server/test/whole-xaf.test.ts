/* XAF has no subunit, and /quotes did not know that.

   Measured on production 2026-10-09, before the fix:

     POST /quotes {"xaf":5000.7}   → 200 { xaf: 5000.7,   feeXaf: 100, totalXaf: 5100.7 }
     POST /quotes {"xaf":5000.999} → 200 { xaf: 5000.999, feeXaf: 100, totalXaf: 5100.999 }
     POST /quotes {"xaf":500.5}    → 200 { xaf: 500.5,    feeXaf: 100, totalXaf: 600.5 }

   The range check (MIN_XAF…MAX_XAF) is happy with 5 000.7, and nothing else looked. That is
   a BINDING quote — it carries the rate, it is what the payment is built from, and it ends
   in a payout instruction for an amount no Mobile Money operator can pay.

   Refused, not rounded: rounding a binding quote changes what the sender asked to send
   without telling them. /momo/transfers/quote already rounds its query param and the v1
   partner intent rounds too — both are inputs we re-state back, which is a different thing
   from a quote the sender is about to be charged against.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/whole-xaf.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { isWholeXaf } = await import("../../shared/domain.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const quote = async (xaf: unknown) => {
    const r = await fetch(`${base}/api/quotes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ xaf, method: "LIGHTNING", country: "CM" }) });
    return { status: r.status, body: await r.json() as { id?: string; error?: string; message?: string } };
  };

  try {
    console.log("\nThe guard itself\n");
    ok("5000 is whole", isWholeXaf(5000));
    ok("5000.7 is not", !isWholeXaf(5000.7));
    ok("a numeric string is not a number", !isWholeXaf("5000"));
    ok("NaN is not whole", !isWholeXaf(NaN));

    console.log("\nA binding quote refuses fractional francs\n");
    for (const xaf of [5000.7, 5000.999, 500.5, 1000.0001]) {
      const { status, body } = await quote(xaf);
      ok(`${xaf} is refused`, status === 400 && body.error === "bad_amount" && !body.id, `${status} ${body.error ?? ""}`);
    }
    const msg = (await quote(5000.7)).body.message ?? "";
    ok("…and says why, in words a developer can act on", /whole number|subunit/i.test(msg), msg);

    console.log("\nWhole amounts are untouched\n");
    for (const xaf of [500, 5000, 12345]) {
      const { status, body } = await quote(xaf);
      ok(`${xaf} still quotes`, status === 200 && !!body.id, String(status));
    }
    ok("1e3 is a whole number written oddly, and is accepted", (await quote(1e3)).status === 200);

    console.log("\nThe range check still does its own job\n");
    ok("0 is still out of range", (await quote(0)).status === 400);
    ok("negative is still out of range", (await quote(-5000)).status === 400);
    ok("absurdly large is still out of range", (await quote(1e12)).status === 400);

    console.log("\n/preview refuses the same amounts, so the refusal is not deferred a step\n");
    const pv = async (xaf: string) => (await fetch(`${base}/api/preview?xaf=${xaf}`)).status;
    ok("preview refuses 5000.7", await pv("5000.7") === 400);
    ok("preview accepts 5000", await pv("5000") === 200);
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
