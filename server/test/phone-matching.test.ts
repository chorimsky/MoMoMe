/* Matching a number to a person — the mistake that cannot be undone.

   Mobile Money is irreversible. Paying the wrong number is not a bug you fix with a retry,
   and in this market the confirmed NAME is the safeguard a sender relies on before pressing
   send. So a matching rule that can cross two people is worse than having no names at all:
   it converts "unknown — confirm manually" into confident, wrong certainty.

   The rules used to be a raw string key and "the last 9 digits", copied into two modules.
   Measured, that gave four distinct ways to pay a stranger, each reproduced below. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import { phoneKey, samePhone, localDigits, checkPhone, isRealName, COUNTRIES } from "../../shared/domain.js";
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

/* ---- the number must FIT the country it was entered under ----
   Payment creation only ever asked for eight digits. That accepted a Gabon number sent as
   Cameroon — MSISDN 23724112345678, fourteen digits, handed to a real payout rail — and a
   number three digits too long that still matched an MTN prefix. Mobile Money does not
   reverse, so these have to be refused before anything is minted. */
const good = checkPhone("677000789", "CM");
ok("a real Cameroon MTN number passes", good.ok && good.provider === "MTN", `${good.reason ?? ""}${good.provider}`);
ok("…and yields the local digits", good.local === "677000789", good.local);

const foreign = checkPhone("+24112345678", "CM");
ok("a Gabon number entered as Cameroon is REFUSED", !foreign.ok, foreign.reason);
ok("…and names the country it actually belongs to", foreign.belongsTo === "GA", foreign.belongsTo);

const tooLong = checkPhone("677000789000", "CM");
ok("three digits too many is refused, despite matching an MTN prefix",
   !tooLong.ok && tooLong.reason === "bad_length", `${tooLong.reason}/${tooLong.provider}`);
ok("too short is refused", !checkPhone("6770007", "CM").ok);

// The dropdown is the thing a sender is most likely to get wrong, so an operator we cannot
// determine is refused rather than routed on the guess.
for (const n of ["620000789", "660000789", "222000789"]) {
  const c = checkPhone(n, "CM");
  ok(`${n} (not an MTN/Orange prefix) is refused, not routed on the dropdown`,
     !c.ok && c.reason === "unknown_operator", c.reason);
}
ok("an Orange prefix routes to Orange, whatever the dropdown said",
   checkPhone("690000789", "CM").provider === "ORANGE", String(checkPhone("690000789", "CM").provider));
ok("every country declares its accepted lengths",
   Object.values(COUNTRIES).every((c) => Array.isArray(c.nsnLen) && c.nsnLen.length > 0));

/* ---- every number must carry the CORRECT name ----
   Payment creation stores `name || phone` because the rails want a label. That string used
   to become the person's NAME in the identity graph and come back at trustLevel 2 as
   verified — the platform asserting that this number belongs to "680344485". */
ok("a real name is a name", isRealName("ALICE MBARGA", "677000789"));
ok("the number written back is NOT a name", !isRealName("677000789", "677000789"));
ok("…nor with the country code on it", !isRealName("237677000789", "677000789"));
ok("…nor formatted", !isRealName("677 000 789", "677000789"));
ok("a blank is not a name", !isRealName("", "677000789") && !isRealName(null, "677000789"));
ok("digits alone are never a name", !isRealName("12345", "677000789"));

const unnamed = ensureIdentity(R("699000111", "699000111"), "r5");
ok("an unnamed recipient does NOT get the digits stored as their name", unnamed.name === "", `"${unnamed.name}"`);
const stillUnknown = await resolveRecipient("699000111", "CM");
ok("…so the trust layer says unknown rather than vouching for a number",
   stillUnknown.status !== "internal", `${stillUnknown.status}/${stillUnknown.name ?? ""}`);

// …and a later real name must be able to correct it. First-write-wins meant it never could.
ensureIdentity(R("699000111", "MARIE FOTSO"), "r6");
ok("a later real name UPGRADES the record", getIdentityByDigits("699000111", "CM")?.name === "MARIE FOTSO",
   getIdentityByDigits("699000111", "CM")?.name);
const named = await resolveRecipient("699000111", "CM");
ok("…and the trust layer now vouches for it", named.status === "internal" && named.name === "MARIE FOTSO",
   `${named.status}/${named.name}`);

// The upgrade is one-way: a blank later payment must not erase a name we trust.
ensureIdentity(R("699000111", "699000111"), "r7");
ok("a later BLANK name does not erase the real one",
   getIdentityByDigits("699000111", "CM")?.name === "MARIE FOTSO", getIdentityByDigits("699000111", "CM")?.name);

/* ---- a Lightning Address must not be payable for a number we cannot settle to ----
   parseLnUser carried its own copy of the old rule, so /.well-known/lnurlp/677000789000
   resolved and returned a payable request. A wallet anywhere in the world could pay it, the
   crypto would land, and the payout MSISDN would be 237677000789000. Minting an invoice for
   a number we cannot settle to is taking money we cannot deliver. */
const { parseLnUser } = await import("../src/core/lnurl.js");
ok("a real number resolves to a Lightning Address", parseLnUser("677000789")?.national === "677000789");
ok("…and with its country code", parseLnUser("237677000789")?.national === "677000789",
   parseLnUser("237677000789")?.national);
ok("an over-long number is NOT payable", parseLnUser("677000789000") === null);
ok("a non-MTN/Orange number is not payable", parseLnUser("620000789") === null);
ok("a too-short number is not payable", parseLnUser("6770007") === null);
ok("an Orange number resolves to Orange", parseLnUser("690000789")?.provider === "ORANGE",
   String(parseLnUser("690000789")?.provider));

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
