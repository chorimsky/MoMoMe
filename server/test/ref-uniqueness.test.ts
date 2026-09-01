/* Payment refs must be unique across CONCURRENT callers.

   The ref is the customer-facing payment id AND the payout idempotency key, and
   payments.ref is UNIQUE. It was minted from a module-level counter persisted via the
   coarse snapshot — per-INSTANCE state pretending to be global. On serverless every
   concurrent instance hydrated the same value and produced the SAME ref, so the second
   insert failed with `duplicate key value violates unique constraint "payments_ref_key"`.
   Because that throw happened inside an async Express route, Express 4 never forwarded it
   to the error handler and the request returned NOTHING — POST /payments hung under any
   concurrency, which is what made this so hard to see.

   Also asserts the response deadline, so a future unhandled rejection is a clean 503
   rather than an open socket. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  const { nextRef } = await import("../src/core/ids.js");
  console.log("\nPayment ref uniqueness");

  // 200 concurrent mints — the pattern that collided.
  const refs = await Promise.all(Array.from({ length: 200 }, () => nextRef()));
  ok("200 concurrent nextRef() calls are all unique", new Set(refs).size === 200, `${new Set(refs).size}/200 distinct`);
  ok("format preserved (MMM-<year>-<n>)", refs.every((r) => /^MMM-\d{4}-\d+$/.test(r)), refs[0]);
  const nums = refs.map((r) => Number(r.split("-")[2])).sort((a, b) => a - b);
  ok("numbers are contiguous (no gaps, no reuse)", nums[nums.length - 1] - nums[0] === 199);

  // Sequential must keep working too.
  const a = await nextRef(), b = await nextRef();
  ok("sequential calls still differ", a !== b, `${a} vs ${b}`);

  console.log("\nA route that never responds returns 503, not an open socket");
  const express = (await import("express")).default;
  const { responseDeadline } = await import("../src/app.js");
  const probe = express();
  probe.use(responseDeadline(300));
  probe.get("/never", () => { /* deliberately never responds — the async-throw shape */ });
  probe.get("/fine", (_q, r) => { r.json({ ok: true }); });
  const server = probe.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const t0 = Date.now();
    const r = await fetch(`${base}/never`);
    const ms = Date.now() - t0;
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    ok("a route that never responds → 503 timeout", r.status === 503 && j.error === "timeout", `${r.status} ${j.error ?? ""}`);
    ok("bounded by the deadline, not left open", ms >= 250 && ms < 3000, `${ms}ms`);
    const h = await fetch(`${base}/fine`);
    ok("a normal route is untouched", h.status === 200);
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
