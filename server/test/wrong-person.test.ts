/* Paying the wrong person — the mistake that cannot be undone.

   Every other check asks whether a number is WELL FORMED: right length, right country, an
   operator we can route to. The commonest real mistake passes all of them. A sender types
   677000789 as 677000798 — nine digits, a valid MTN prefix, a real Cameroonian subscriber —
   and Mobile Money does not reverse. Formal validation cannot see it, because there is
   nothing malformed to see.

   What can see it is the sender's own history: somebody paying a number one digit away from
   one they have paid three times is making a typo, not discovering a new payee.

   Two things are load-bearing. The interlock is on the SERVER — a tick box in the send
   screen protects people running that build of the UI and nobody else, not a stale client,
   a partner integration or a direct API call. And a sender who HAS paid this number before
   must sail through, because a system that warns on every payment trains people to click
   past the warning that matters. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "risk-test-secret";

import type { Payment } from "../../shared/types.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const { assessRecipient, verifyRiskToken } = await import("../src/core/recipientRisk.js");
const { store } = await import("../src/db/store.js");

const SENDER = "device-alice";
let n = 0;
async function paid(phone: string, name: string, senderId = SENDER) {
  const now = new Date(Date.now() + n++).toISOString();
  await store().putPayment({
    id: `pay_${n}`, ref: `MMM-${n}`, quoteId: `q_${n}`, state: "DELIVERED", displayStatus: "Completed",
    method: "LIGHTNING", senderId,
    recipient: { phone, country: "CM", provider: "MTN", name, nameSource: "manual" },
    xaf: 5000, feeXaf: 25, totalXaf: 5025, usd: 8,
    payInstruction: { method: "LIGHTNING", code: "ln", qr: "lightning:ln", asset: "BTC", amount: 0.0001,
      amountLabel: "x", expiresAt: now, providerRef: `ph_${n}`, provider: "ibex" },
    events: [], createdAt: now, updatedAt: now,
  } as Payment);
}

console.log("\nPaying the wrong person — is this who you meant?\n");

await paid("677000789", "ALICE MBARGA");
await paid("677000789", "ALICE MBARGA");
await paid("677000789", "ALICE MBARGA");

/* ---- the number they have actually been paying sails through ---- */
const same = await assessRecipient({ senderId: SENDER, phone: "677000789", country: "CM", xaf: 5000 });
ok("a number this sender has paid before raises nothing", same.level === "none", same.level);
ok("…including when written differently",
   (await assessRecipient({ senderId: SENDER, phone: "+237 677 000 789", country: "CM", xaf: 5000 })).level === "none");

/* ---- ONE DIGIT WRONG: the mistake formal validation cannot see ---- */
const typo = await assessRecipient({ senderId: SENDER, phone: "677000798", country: "CM", xaf: 5000 });
ok("one digit different from a number they know STOPS them", typo.level === "stop", typo.level);
ok("…and names who they probably meant", typo.didYouMean?.name === "ALICE MBARGA", typo.didYouMean?.name);
ok("…and says how often they paid her", typo.didYouMean?.timesPaid === 3, String(typo.didYouMean?.timesPaid));
ok("…and says the payment cannot be reversed", /cannot be reversed/i.test(typo.message ?? ""), typo.message);

const sub = await assessRecipient({ senderId: SENDER, phone: "677000889", country: "CM", xaf: 5000 });
ok("a substitution anywhere in the number is caught", sub.level === "stop" && sub.code === "near_miss", sub.code);

const swap = await assessRecipient({ senderId: SENDER, phone: "677000798", country: "CM", xaf: 5000 });
ok("transposed digits are caught", swap.level === "stop", `${swap.code}`);

const dropped = await assessRecipient({ senderId: SENDER, phone: "67700078", country: "CM", xaf: 5000 });
ok("a dropped digit is caught", dropped.level === "stop" && dropped.code === "digit_dropped", dropped.code);

/* ---- a genuinely different number is not a near miss ---- */
const other = await assessRecipient({ senderId: SENDER, phone: "699123456", country: "CM", xaf: 5000 });
ok("a number unlike anything they have paid is advisory, not a stop", other.level === "check", other.level);
ok("…and still tells them to check it", /check it/i.test(other.message ?? ""), other.message);

/* ---- one sender's payees say nothing about another's ---- */
const stranger = await assessRecipient({ senderId: "device-bob", phone: "677000798", country: "CM", xaf: 5000 });
ok("another sender's history is not consulted — it would leak who pays whom",
   stranger.level === "check", stranger.level);

/* ---- the acknowledgement is per warning, not a blanket opt-out ---- */
ok("the right token opens the door",
   verifyRiskToken(SENDER, "677000798", "CM", 5000, typo.code!, typo.token!));
ok("a token for a DIFFERENT amount does not",
   !verifyRiskToken(SENDER, "677000798", "CM", 999999, typo.code!, typo.token!));
ok("a token for a DIFFERENT number does not",
   !verifyRiskToken(SENDER, "677000889", "CM", 5000, typo.code!, typo.token!));
ok("another sender cannot reuse it",
   !verifyRiskToken("device-bob", "677000798", "CM", 5000, typo.code!, typo.token!));
ok("a made-up token does not", !verifyRiskToken(SENDER, "677000798", "CM", 5000, typo.code!, "deadbeefdeadbeef"));
ok("nor an empty one", !verifyRiskToken(SENDER, "677000798", "CM", 5000, typo.code!, ""));

/* ---- once she is a known payee, near-misses to HER still fire ---- */
await paid("699123456", "MARIE FOTSO");
const second = await assessRecipient({ senderId: SENDER, phone: "699123465", country: "CM", xaf: 5000 });
ok("a new payee immediately protects against typos of THEIR number",
   second.level === "stop" && second.didYouMean?.name === "MARIE FOTSO", second.didYouMean?.name);

/* ---- an unnamed past payee is still named by number ---- */
await paid("650111222", "650111222");
const unnamed = await assessRecipient({ senderId: SENDER, phone: "650111223", country: "CM", xaf: 5000 });
ok("a past payee with no name is referred to by number, not by a fake one",
   unnamed.level === "stop" && unnamed.didYouMean?.name === undefined, JSON.stringify(unnamed.didYouMean));

/* ---- no sender id: nothing to compare against, and we say so by staying quiet ---- */
ok("an anonymous caller gets no history-based claim",
   (await assessRecipient({ phone: "677000798", country: "CM", xaf: 5000 })).level === "none");

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
