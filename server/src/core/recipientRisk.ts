/* ============================================================
   "Is this the person you meant?" — catching a payment to the wrong number.

   Every check before this one asks whether a number is WELL FORMED: right length, right
   country, an operator we can route to. The dominant real-world mistake passes all of them.
   A sender types 677000789 as 677000798 — nine digits, valid MTN prefix, a real Cameroonian
   subscriber — and Mobile Money does not reverse. Formal validation cannot see it, because
   there is nothing malformed to see.

   What CAN see it is the sender's own history. Someone paying a number one digit away from
   one they have paid three times before is almost certainly making a typo, not discovering a
   new payee, and that is a signal strong enough to stop and ask about. It is also a signal
   nothing else in the system has: the payout rail cannot know who this sender usually pays.

   The interlock lives HERE, on the server, not only in the send screen. A tick box in the UI
   protects people using that build of the UI; it does nothing for a stale client, a partner
   integration, or a direct API call. And it is acknowledged with a token derived from the
   specific warning, so "I saw it" cannot be a constant a caller sets once and forgets.
   ============================================================ */
import crypto from "node:crypto";
import type { CountryCode, Payment } from "../../../shared/types.js";
import { phoneKey, localDigits, isRealName } from "../../../shared/domain.js";
import { store } from "../db/store.js";

export type RiskLevel = "none" | "check" | "stop";

export interface RecipientRisk {
  level: RiskLevel;
  /** Machine-readable, for clients that want to render their own copy. */
  code?: "near_miss" | "transposed" | "digit_dropped" | "first_time_unnamed";
  /** Written to be read by the person about to lose the money. */
  message?: string;
  /** The number they may have meant, when we think we know. */
  didYouMean?: { phone: string; name?: string; timesPaid: number };
  /** Echo this back to proceed. Derived from THIS warning for THIS payment. */
  token?: string;
}

/** One substitution: same length, exactly one position differs. The commonest typo. */
function oneSubstitution(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff += 1; if (diff > 1) return false; }
  return diff === 1;
}

/** Two adjacent digits swapped — the other commonest typo, and invisible to a length check. */
function adjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const at: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
  return at.length === 2 && at[1] === at[0] + 1 && a[at[0]] === b[at[1]] && a[at[1]] === b[at[0]];
}

/** One digit typed twice, or one missed. */
function oneInsertion(shorter: string, longer: string): boolean {
  if (longer.length - shorter.length !== 1) return false;
  let i = 0, j = 0, skips = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue; }
    if (++skips > 1) return false;
    j++;
  }
  return true;
}

/** Stable per (sender, recipient, amount, reason). A caller cannot pre-compute a blanket
 *  "yes" — the token only opens the door for the exact payment it was issued about. */
function tokenFor(senderId: string, key: string, xaf: number, code: string): string {
  const secret = (process.env.ADMIN_SESSION_SECRET ?? "mm-risk").slice(0, 64);
  return crypto.createHmac("sha256", secret).update(`${senderId}|${key}|${xaf}|${code}`).digest("hex").slice(0, 16);
}

export function verifyRiskToken(senderId: string, phone: string, country: CountryCode, xaf: number, code: string, token: string): boolean {
  const expected = tokenFor(senderId, phoneKey(phone, country), xaf, code);
  const a = Buffer.from(expected), b = Buffer.from(String(token ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Assess a payment before it is created.
 *
 * "stop" means the sender must confirm they meant it; "check" is advisory. Only the
 * sender's OWN history is used — another customer's payees say nothing about who this
 * person meant to pay, and reaching across senders would leak who pays whom.
 */
export async function assessRecipient(input: {
  senderId?: string;
  phone: string;
  country: CountryCode;
  xaf: number;
}): Promise<RecipientRisk> {
  const { senderId, phone, country, xaf } = input;
  if (!senderId) return { level: "none" };

  const target = localDigits(phone, country);
  const key = phoneKey(phone, country);

  // The sender's own delivered payments, newest first.
  const mine = (await store().listPayments())
    .filter((p) => p.senderId === senderId && p.displayStatus !== "Failed")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const byRecipient = new Map<string, { phone: string; country: CountryCode; name: string; count: number }>();
  for (const p of mine) {
    const k = phoneKey(p.recipient.phone, p.recipient.country);
    const e = byRecipient.get(k);
    if (e) { e.count += 1; if (!isRealName(e.name, e.phone) && isRealName(p.recipient.name, p.recipient.phone)) e.name = p.recipient.name; }
    else byRecipient.set(k, { phone: p.recipient.phone, country: p.recipient.country, name: p.recipient.name, count: 1 });
  }

  // Paid this exact number before → the safest signal there is. Nothing to warn about.
  if (byRecipient.has(key)) return { level: "none" };

  for (const [k, prev] of byRecipient) {
    if (k === key) continue;
    if (prev.country !== country) continue; // a different country is a different number, not a typo
    const other = localDigits(prev.phone, prev.country);
    const code: RecipientRisk["code"] | null =
      oneSubstitution(target, other) ? "near_miss"
      : adjacentTransposition(target, other) ? "transposed"
      : (oneInsertion(target, other) || oneInsertion(other, target)) ? "digit_dropped"
      : null;
    if (!code) continue;

    const who = isRealName(prev.name, prev.phone) ? prev.name : prev.phone;
    const times = prev.count === 1 ? "once" : `${prev.count} times`;
    const how = code === "transposed" ? "two digits swapped"
      : code === "digit_dropped" ? "one digit different in length"
      : "one digit different";
    return {
      level: "stop",
      code,
      message: `This number is ${how} from ${who}, who you have paid ${times}. Check it carefully — Mobile Money payments cannot be reversed.`,
      didYouMean: { phone: prev.phone, name: isRealName(prev.name, prev.phone) ? prev.name : undefined, timesPaid: prev.count },
      token: tokenFor(senderId, key, xaf, code),
    };
  }

  // Never paid by this sender, and nobody can tell us whose number it is. Advisory rather
  // than blocking: it is the ordinary state of a first payment, and stopping every one of
  // those trains people to click through the warning that matters.
  return {
    level: "check",
    code: "first_time_unnamed",
    message: "You have not paid this number before. Check it against the person you mean to pay — Mobile Money payments cannot be reversed.",
    token: tokenFor(senderId, key, xaf, "first_time_unnamed"),
  };
}
