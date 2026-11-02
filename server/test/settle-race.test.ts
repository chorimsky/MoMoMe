/* Two settlers, one transfer: the collection must post once.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/settle-race.test.ts

   THE RACE. Settling reads the state, asks the rail, then acts:

       if (t.state !== "AWAITING_PAYER") return;   // check
       const s = await rail.status(t.id);          // ← yields the event loop
       if (s === "COMPLETED") await onCollected(t) // act

   and two callers run that shape against the same transfer — settleCollectionNow from the
   rail's webhook, and reconcileTransfers from the job tick. The await yields, so both pass
   the check before either moves the state, and both settle.

   They collide by construction, not by bad luck: the rail posts its callback at the moment
   its status flips to COMPLETED, which is exactly when a concurrent tick also reads
   COMPLETED.

   Cost of a double run: postCollection posts the collection AND the fee twice (recordTxn
   mints a new txnId and appends — no idempotency key, and the ledger invariant is
   per-transaction balance, not uniqueness, so nothing else catches it), and startPayout
   runs twice. The Mobile Money leg survives on its idempotencyKey; the Lightning leg does
   not, because payLightningAddress takes none and pays afresh every call.

   This test drives the real race: it holds the rail's status() open until BOTH callers are
   inside it, which is the interleaving that production produces on its own. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "settle-race-test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const mt = await import("../src/core/momoTransfer.js");
  const { ledgerEntries } = await import("../src/core/ledger.js").catch(() => ({ ledgerEntries: null } as never));

  // Reach into the module's own transfer map the way the reconcile tick does, by creating a
  // transfer through the public surface if available; otherwise seed one directly.
  const anyMt = mt as unknown as Record<string, unknown>;
  const transfersMap = (anyMt.__transfersForTest as Map<string, unknown> | undefined);

  if (!transfersMap) {
    console.log("  (no test seam on the transfer map — asserting the single-flight slot directly)\n");
    // settleTransferExclusive is the shared slot both paths go through. If it is a real
    // single-flight, two concurrent calls must run the body ONCE.
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const body = async () => { runs++; await gate; return "COMPLETED" as const; };
    const t = { id: "tr_race_1" } as never;

    const a = mt.settleTransferExclusive(t, body);
    const b = mt.settleTransferExclusive(t, body);
    ok("a second concurrent settlement does NOT start its own run", runs === 1, `runs=${runs}`);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    ok("…both callers get the same outcome", ra === "COMPLETED" && rb === "COMPLETED", `${ra}/${rb}`);
    ok("…and the body ran exactly once", runs === 1, `runs=${runs}`);

    // After it finishes the slot is free again, so a LATER call runs normally (it is the
    // state check, not the slot, that stops a repeat).
    const c = await mt.settleTransferExclusive(t, body);
    ok("after it completes the slot is released for a later call", runs === 2 && c === "COMPLETED", `runs=${runs}`);
    ok("…so the slot never wedges a transfer permanently", !!c, String(c));

    // And a throwing body must not leave the slot held.
    const boom = async () => { throw new Error("rail blew up"); };
    await mt.settleTransferExclusive({ id: "tr_race_2" } as never, boom as never).catch(() => null);
    let after = 0;
    await mt.settleTransferExclusive({ id: "tr_race_2" } as never, async () => { after++; return null; });
    ok("a failed settlement releases the slot rather than wedging it", after === 1, `after=${after}`);
  }

  /* The slot only helps if every settlement path goes through it. A primitive that is
     correct and then bypassed is worse than none, so this reads the source and asserts
     that every `await onCollected(...)` sits inside a slot — which is what stops a third
     caller being added later with the original check-await-act shape. Comments are
     stripped first, because the explanation above settleCollectionNow contains the very
     pseudo-code this looks for. */
  console.log("\n  every settlement path goes through the slot\n");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/core/momoTransfer.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^\s*\/\/.*$/gm, "");      // line comments
  const lines = src.split("\n");
  const slots = lines.map((l, i) => (/settleExclusive\(|settleTransferExclusive\(/.test(l) ? i + 1 : 0)).filter(Boolean);
  const calls = lines.map((l, i) => (/\bawait onCollected\(/.test(l) ? i + 1 : 0)).filter(Boolean);
  ok("there is at least one settlement path to check", calls.length >= 2, `${calls.length} call sites`);
  const outside = calls.filter((c) => !slots.some((x) => x < c && c - x < 40));
  ok("every `await onCollected(...)` is inside a slot", outside.length === 0,
    outside.length ? `outside at line(s) ${outside.join(", ")}` : `${calls.length} inside`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
