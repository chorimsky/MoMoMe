/* Money that arrives with no payment to attach it to must still be recorded.

   The rail webhook ended at:

       const payment = await store().findByProviderRef(event.providerRef);
       if (!payment) return res.json({ ok: true, unmatched: true });

   A 200, and nothing else. Crypto had landed on an address or invoice this platform issued
   and the platform kept no record of it — no ledger entry, no log, nothing an operator
   could ever see — while a customer waited on a screen that would never change.

   It happens for ordinary reasons: a receive address reused from an earlier payment, an
   invoice whose payment record was never created because the payout pre-flight refused it,
   a rail replaying an event for a payment since pruned. And for a money transmitter it is
   the wrong answer on its own terms — funds received without an identified purpose are
   precisely what must be recorded and reviewed, not dropped because a lookup missed.

   Nothing here is auto-delivered. Without a quote there is no recipient, no rate and no
   obligation; inventing one would be worse than holding the money. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const { recordUnattributedInbound } = await import("../src/core/stateMachine.js");
const { listUnattributed, openUnattributed, resolveUnattributed, captureUnattributed } =
  await import("../src/core/unattributed.js");
const { store } = await import("../src/db/store.js");

console.log("\nUnattributed inbound — nothing arrives unrecorded\n");

const s = store();

/* ---- a Lightning receipt with no payment ---- */
const HASH = "9f2a1c4e8b7d6a5f3e2d1c0b9a8f7e6d5c4b3a2918273645546372819aabbccd";
const r1 = await recordUnattributedInbound({ rail: "ibex", providerRef: HASH, eventId: "evt-1", amount: 0.0004 });

ok("it is recorded rather than dropped", listUnattributed().length === 1, `${listUnattributed().length} record(s)`);
ok("the asset is inferred as BTC from a payment hash", r1.asset === "BTC", r1.asset);
ok("and it is booked, because the asset is known", r1.booked === true);

const held = await s.balance("refund_payable", "BTC");
ok("it lands in refund_payable — money that is not ours", held === -0.0004, String(held));
const clearing = await s.balance("inbound_clearing", "BTC");
ok("against inbound_clearing — an asset we hold", clearing === 0.0004, String(clearing));

/* ---- the books must still balance ---- */
const netBtc = (await s.allEntries()).filter((e) => e.currency === "BTC")
  .reduce((n, e) => n + (e.direction === "debit" ? e.amount : -e.amount), 0);
ok("BTC nets to zero — it is a balanced posting, not an invention", Math.abs(netBtc) < 1e-12, String(netBtc));

/* ---- a redelivered webhook must not double-book ---- */
const again = await recordUnattributedInbound({ rail: "ibex", providerRef: HASH, eventId: "evt-1", amount: 0.0004 });
ok("a redelivery does not create a second record", listUnattributed().length === 1);
ok("…and does not book twice", (await s.balance("refund_payable", "BTC")) === -0.0004,
   String(await s.balance("refund_payable", "BTC")));
ok("but it IS counted as seen again", listUnattributed()[0].seenCount === 2, String(listUnattributed()[0].seenCount));
ok("the redelivery reports the same record", again.id === r1.id);

/* ---- a genuinely SECOND deposit to the same address is its own receipt ---- */
const ADDR = "bc1qrlly5ez3qvjyjxxdhxkafn99vrugkrqptgshh5";
await recordUnattributedInbound({ rail: "ibex", providerRef: ADDR, eventId: "evt-2", amount: 0.001 });
await recordUnattributedInbound({ rail: "ibex", providerRef: ADDR, eventId: "evt-3", amount: 0.002 });
ok("two different deposits to one address are two receipts", listUnattributed().length === 3,
   `${listUnattributed().length} records`);
ok("both are booked", Math.abs((await s.balance("refund_payable", "BTC")) - -0.0034) < 1e-12,
   String(await s.balance("refund_payable", "BTC")));

/* ---- an on-chain address is recognised as BTC ---- */
ok("a bech32 address is read as on-chain BTC",
   listUnattributed().some((r) => r.providerRef === ADDR && r.asset === "BTC" && r.method === "ONCHAIN"));

/* ---- an ERC-20 address cannot say USDT from USDC ----
   Recording it is still required; guessing a currency to keep the books tidy would put a
   wrong number in them, so the posting is withheld and the record says so. */
const ERC = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const r4 = await recordUnattributedInbound({ rail: "ibex", providerRef: ERC, eventId: "evt-4", amount: 25 });
ok("a stablecoin receipt is still RECORDED", listUnattributed().some((r) => r.providerRef === ERC));
ok("…but not booked, because the asset is ambiguous", r4.booked === false, r4.asset);
ok("and the record says the asset is unknown", r4.asset === "UNKNOWN_STABLECOIN", r4.asset);

/* ---- nothing is auto-delivered ---- */
ok("no payment record is invented for it", (await s.listPayments()).length === 0,
   `${(await s.listPayments()).length} payments`);

/* ---- an operator can close the book, and the record survives ---- */
ok("all four are open for review", openUnattributed().length === 4, String(openUnattributed().length));
const resolved = resolveUnattributed(r1.id, "refunded", "returned to sender out of band");
ok("resolving marks it", resolved?.resolution === "refunded" && !!resolved?.resolvedAt);
ok("it leaves the open list", openUnattributed().length === 3, String(openUnattributed().length));
ok("but the RECORD is kept — the audit question is what happened to it",
   listUnattributed().length === 4, String(listUnattributed().length));

const twice = resolveUnattributed(r1.id, "ignored");
ok("resolving again does not overwrite the first decision", twice?.resolution === "refunded", twice?.resolution);
ok("an unknown id resolves to nothing", resolveUnattributed("unat_nope", "ignored") === null);

/* ---- capture is pure: no ledger side effects of its own ---- */
const before = await s.balance("refund_payable", "BTC");
captureUnattributed({ rail: "ibex", providerRef: "x", method: "LIGHTNING", asset: "BTC", amount: 1 });
ok("the store itself books nothing — posting is the caller's job",
   (await s.balance("refund_payable", "BTC")) === before, String(await s.balance("refund_payable", "BTC")));

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
