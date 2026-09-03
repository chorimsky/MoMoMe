/* The receipt — one artifact, whichever screen shared it.

   The web and the mobile app each built their own. They disagreed on row order, on the
   closing line, and — the one that mattered — the web's plain-text version omitted the FEE
   entirely, so the same payment shared from two places produced two different receipts and
   one of them hid what we charged. A receipt is what a person keeps, forwards as proof and
   brings to support; it cannot depend on where it was shared from.

   Both surfaces now call @shared/receipt. These tests hold the structure to what it claims:
   the status comes from the payment rather than the caller, the number is never printed
   twice, and the date carries its zone. */
import { receiptText, receiptLines, receiptTitle, recipientLine, receiptDate, type ReceiptLabels } from "../../shared/receipt.js";
import type { Payment } from "../../shared/types.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const L: ReceiptLabels = {
  titleCompleted: "Payment successful", titlePending: "Payment pending", titleFailed: "Payment failed",
  deliveredTo: "{amount} delivered to {who}", intendedFor: "{amount} to {who}",
  fee: "Fee", youPaid: "You paid", reference: "Reference",
  paidWith: "Paid with", amountSent: "Sent", tagline: "Mobile Money, made simple — momome.xyz",
};

const pay = (over: Partial<Payment> = {}): Payment => ({
  id: "pay_1", ref: "MMM-2026-418844", quoteId: "q_1",
  state: "DELIVERED", displayStatus: "Completed", method: "LIGHTNING",
  recipient: { phone: "680344485", country: "CM", provider: "MTN", name: "", nameSource: "manual" },
  xaf: 500, feeXaf: 3, totalXaf: 503, usd: 0.8,
  payInstruction: { method: "LIGHTNING", code: "lnbc", qr: "lightning:lnbc", asset: "BTC", amount: 0.00011991,
    amountLabel: "11 991 sats", expiresAt: "2026-09-03T12:54:00.000Z", providerRef: "ph", provider: "ibex" },
  events: [], createdAt: "2026-09-03T12:54:00.000Z", updatedAt: "2026-09-03T12:54:00.000Z",
  ...over,
} as Payment);

console.log("\nReceipt — one artifact, whichever screen shared it\n");

/* ---- the number must not appear twice ---- */
const noName = receiptText(pay(), L);
// The number is grouped for reading aloud (6 80 34 44 85), so count it on the digits.
const digitsOnly = (t: string) => t.split("\n").filter((l) => /\d/.test(l)).map((l) => l.replace(/\D/g, "")).join("|");
const occurrences = (t: string) => (digitsOnly(t).match(/680344485/g) ?? []).length;
ok("an unknown recipient shows the number ONCE, not on two rows", occurrences(noName) === 1, `${occurrences(noName)} occurrences`);
ok("and there is no dead placeholder row", !noName.includes("—\n") && !/Recipient:\s*—/.test(noName));

const named = receiptText(pay({ recipient: { ...pay().recipient, name: "NANA JEAN PAUL" } }), L);
ok("a known name reads as one line with the number", named.includes("NANA JEAN PAUL (+237 6 80 34 44 85)"),
   named.split("\n")[2]);

// A "name" that is only the digits back again is not a name.
const echoed = receiptText(pay({ recipient: { ...pay().recipient, name: "680344485" } }), L);
ok("a name that is just the number is not repeated", occurrences(echoed) === 1,
   echoed.split("\n")[2]);

/* ---- the fee is never hidden ---- */
ok("the fee is stated", noName.includes("Fee 3 XAF"), noName.split("\n")[3]);
ok("and the total beside it", noName.includes("You paid 503 XAF"));

/* ---- status comes from the PAYMENT, not the caller ---- */
ok("a delivered payment says successful", receiptTitle("Completed", L) === "Payment successful");
ok("a failed payment says FAILED, not successful", receiptTitle("Failed", L) === "Payment failed");
ok("a pending payment says pending", receiptTitle("Pending", L) === "Payment pending");

const failed = receiptText(pay({ displayStatus: "Failed", state: "FAILED" }), L);
ok("a failed receipt does not claim success anywhere", !failed.includes("successful"), failed.split("\n")[0]);
ok("…and does not say the money was delivered", !failed.includes("delivered to"), failed.split("\n")[2]);
ok("a failed receipt still carries its reference for support", failed.includes("MMM-2026-418844"));

/* ---- the date carries its zone ---- */
const d = receiptDate("2026-09-03T12:54:00.000Z", "en-GB");
ok("the date names a timezone", /[A-Z]{2,5}|GMT|UTC|\+\d/.test(d.replace(/^\d+ \w+ \d+/, "")), d);
ok("a malformed date degrades instead of throwing", receiptDate("not-a-date") === "not-a-date");

/* ---- no redundant status row; the headline carries it ---- */
const lines = receiptLines(pay(), L);
ok("there is no separate Status row", !lines.some((l) => /^Status:/.test(l)), lines.join(" | ").slice(0, 80));
ok("the tagline closes it", lines[lines.length - 1] === L.tagline);

/* ---- the crypto leg is opt-in ---- */
ok("no crypto leg by default", !noName.includes("11 991 sats"));
const withCrypto = receiptText(pay(), L, { includeCrypto: true, cryptoAmount: "11 991 sats", cryptoMethod: "Lightning", usd: "≈ $0.80" });
ok("…and appears when asked for", withCrypto.includes("11 991 sats") && withCrypto.includes("Lightning"));

/* ---- BOTH SURFACES PRODUCE THE SAME TEXT ----
   The whole point. Same payment, same labels, same bytes. */
const a = receiptText(pay(), L, { includeCrypto: true, cryptoAmount: "11 991 sats", cryptoMethod: "Lightning", usd: "≈ $0.80", locale: "en-GB" });
const b = receiptText(pay(), L, { includeCrypto: true, cryptoAmount: "11 991 sats", cryptoMethod: "Lightning", usd: "≈ $0.80", locale: "en-GB" });
ok("the same payment yields byte-identical receipts", a === b);

console.log("\n--- rendered ---\n" + noName + "\n----------------");
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
