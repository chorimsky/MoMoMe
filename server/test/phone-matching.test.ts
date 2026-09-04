/* Matching a number to a person — the mistake that cannot be undone.

   Mobile Money is irreversible. Paying the wrong number is not a bug you fix with a retry,
   and in this market the confirmed NAME is the safeguard a sender relies on before pressing
   send. So a matching rule that can cross two people is worse than having no names at all:
   it converts "unknown — confirm manually" into confident, wrong certainty.

   The rules used to be a raw string key and "the last 9 digits", copied into two modules.
   Measured, that gave four distinct ways to pay a stranger, each reproduced below. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import { phoneKey, samePhone, localDigits } from "../../shared/domain.js";
import type { Recipient } from "../../shared/types.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const { ensureIdentity, getIdentityByDigits, listIdentities } = await import("../src/core/identity.js");
const { resolveRecipient } = await import("../src/core/nameResolver.js");

const R = (phone: string, name: string, country: Recipient["country"] = "CM"): Recipient =>
  ({ phone, country, provider: "MTN", name, nameSource: "manual" }) as Recipient;

console.log("\nPhone matching — one number, one person, one country\n");

/* ---- the key itself ---- */
ok("spacing does not change the key", phoneKey("677 000 789", "CM") === phoneKey("677000789", "CM"));
ok("a country code does not change the key", phoneKey("+237677000789", "CM") === phoneKey("677000789", "CM"),
   phoneKey("+237677000789", "CM"));
ok("punctuation does not change the key", phoneKey("(+237) 677-000-789", "CM") === phoneKey("677000789", "CM"));
ok("the SAME digits in a DIFFERENT country are a DIFFERENT key",
   phoneKey("677000789", "CM") !== phoneKey("677000789", "CG"),
   `${phoneKey("677000789", "CM")} vs ${phoneKey("677000789", "CG")}`);
ok("samePhone agrees", samePhone("+237 677 000 789", "677000789", "CM") && !samePhone("677000789", "677000788", "CM"));

// 8-digit countries: the old rule could not match one of these to itself.
ok("an 8-digit country round-trips (Gabon, local vs with country code)",
   phoneKey("12345678", "GA") === phoneKey("+24112345678", "GA"),
   `${phoneKey("12345678", "GA")} vs ${phoneKey("+24112345678", "GA")}`);
ok("…and localDigits strips the right number of digits", localDigits("+24112345678", "GA") === "12345678",
   localDigits("+24112345678", "GA"));

/* ---- ONE person, however they are typed ---- */
ensureIdentity(R("677000789", "ALICE MBARGA"), "r1");
ensureIdentity(R("677 000 789", "ALICE MBARGA"), "r2");
ensureIdentity(R("+237677000789", "ALICE MBARGA"), "r3");
ok("three spellings of one number make ONE identity", listIdentities().length === 1,
   `${listIdentities().length} identities`);

/* ---- the identity's own payable address must be payable ---- */
const alice = getIdentityByDigits("677000789", "CM");
ok("e164 carries the country code exactly once", alice?.e164 === "+237677000789", alice?.e164);
ok("the Lightning address is the payable number, not a doubled one",
   alice?.lightningAddress === "237677000789@momome.xyz", alice?.lightningAddress);

/* ---- lookup tolerates any spelling, within the country ---- */
for (const form of ["677000789", "677 000 789", "+237677000789", "(237) 677-000-789"]) {
  ok(`"${form}" finds her`, getIdentityByDigits(form, "CM")?.customerId === alice?.customerId);
}

/* ---- THE ONE THAT MATTERS: no crossing borders ----
   A Congo +242 subscriber sharing nine digits used to BECOME the Cameroonian — ensureIdentity
   returned her record — and a lookup of the Congo number answered with her name, verified. */
const congo = ensureIdentity(R("677000789", "JEAN NGOMA", "CG"), "r4");
ok("a same-digits number in another country is a DIFFERENT person",
   congo.customerId !== alice?.customerId, `${congo.customerId} vs ${alice?.customerId}`);
ok("…and keeps its own name", congo.name === "JEAN NGOMA", congo.name);
ok("…and its own dial code", congo.e164 === "+242677000789", congo.e164);
ok("looking up the Congo number does NOT return the Cameroonian",
   getIdentityByDigits("677000789", "CG")?.name === "JEAN NGOMA", getIdentityByDigits("677000789", "CG")?.name);
ok("and the Cameroonian is still herself",
   getIdentityByDigits("677000789", "CM")?.name === "ALICE MBARGA");

/* ---- the trust layer inherits the scoping ---- */
const cm = await resolveRecipient("677000789", "CM");
ok("the trust layer vouches for the right person in her country",
   cm.status === "internal" && cm.name === "ALICE MBARGA", `${cm.status}/${cm.name}`);
const cg = await resolveRecipient("677000789", "CG");
ok("…and does not hand her name to a different country's number",
   cg.name !== "ALICE MBARGA", `${cg.status}/${cg.name}`);

/* ---- a near-miss must never match ---- */
ok("one digit different is a different person", !getIdentityByDigits("677000788", "CM"));
ok("a truncated number is a different person", !getIdentityByDigits("67700078", "CM"));
ok("extra leading digits do not silently match", !getIdentityByDigits("99677000789", "CM"));

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
