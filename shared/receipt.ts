/* ============================================================
   The payment receipt — ONE builder for every surface.

   The web and the mobile app each had their own, and they disagreed: different row order,
   a different closing line, and the web's plain-text version omitted the fee entirely. The
   same payment shared from two places produced two different receipts, one of which hid
   what we charged. A receipt is the artifact a person keeps, forwards as proof, and brings
   to support — it cannot depend on which screen it was shared from.

   Both surfaces now call this. Labels come from the caller so each keeps its own i18n
   plumbing; the STRUCTURE, the ordering and the status live here.
   ============================================================ */
import type { Payment, DisplayStatus } from "./types.js";
import { COUNTRIES } from "./domain.js";

export interface ReceiptLabels {
  /** Headline, chosen by actual payment state — see receiptTitle. */
  titleCompleted: string;
  titlePending: string;
  titleFailed: string;
  /** "{amount} delivered to {who}" — both placeholders required. */
  deliveredTo: string;
  /** "{amount} to {who}" for a payment that has NOT been delivered, so a pending or
   *  failed receipt never reads as though money arrived. */
  intendedFor: string;
  fee: string;
  youPaid: string;
  reference: string;
  paidWith: string;
  amountSent: string;
  tagline: string;
}

/** The headline, derived from the payment rather than assumed by the caller.
 *
 *  Both builders used to hard-code "Completed". Mobile happened to open the receipt only
 *  for delivered payments, so it was true — but a proof-of-payment artifact must not depend
 *  on its caller remembering that. A receipt for a payment that failed now says so. */
export function receiptTitle(status: DisplayStatus, l: ReceiptLabels): string {
  return status === "Completed" ? l.titleCompleted
    : status === "Failed" ? l.titleFailed
    : l.titlePending;
}

/** International number, grouped for reading aloud: +237 6 80 34 44 85.
 *  Cameroon writes mobile numbers in pairs after the leading digit, which is how a person
 *  reads one back over the phone to confirm it. */
export function displayPhone(p: Payment): string {
  const dial = COUNTRIES[p.recipient.country]?.dial ?? "";
  const d = p.recipient.phone.replace(/\D/g, "");
  const grouped = d.length === 9 ? `${d[0]} ${d.slice(1).replace(/(\d{2})(?=\d)/g, "$1 ")}`.trim() : d;
  return `${dial} ${grouped}`.trim();
}

/** Who the money went to: the name when we actually know one, otherwise just the number.
 *
 *  The old receipts printed `Recipient: {name || "—"}` on its own row and the number on the
 *  next, so an unknown recipient got a dead "—" row and a known one had their number shown
 *  twice. Since the identity graph only vouches for numbers that have really been paid,
 *  "no name" is the ordinary case, not the exception. */
export function recipientLine(p: Payment): string {
  const phone = displayPhone(p);
  const name = p.recipient.name?.trim();
  // A "name" that is just the digits back again is not a name.
  if (!name || name.replace(/\D/g, "") === p.recipient.phone.replace(/\D/g, "")) return phone;
  return `${name} (${phone})`;
}

/** Date with its ZONE. toLocaleString in the device's locale renders in the DEVICE's
 *  timezone and says nothing about which one — so a sender in Paris shares "13:54" and the
 *  recipient in Douala reads it as WAT. On a payment proof that ambiguity is the whole
 *  problem, so the zone is stamped. */
export function receiptDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(locale, {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
  } catch {
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
}

const fill = (tpl: string, vars: Record<string, string>): string =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

const xaf = (n: number): string => `${Math.round(n).toLocaleString("en-US").replace(/,/g, " ")} XAF`;

export interface ReceiptOptions {
  /** Include the crypto leg (what was sent, and its USD value). Off when sharing with the
   *  recipient, who is being paid Mobile Money and has no use for it. */
  includeCrypto?: boolean;
  /** How the crypto amount reads, e.g. "11 991 sats" — surface-specific formatting. */
  cryptoAmount?: string;
  cryptoMethod?: string;
  usd?: string;
  locale?: string;
  brand?: string;
}

/**
 * The canonical receipt, as lines.
 *
 * Shape, and why: the transaction is ONE sentence — amount and destination together —
 * because that is the thing being confirmed, and splitting it across two rows is what
 * produced the duplicate number. Money detail sits under it, subordinate: the sender knows
 * what they paid, what they are checking is that the right amount reached the right number.
 * Reference and date are a separate block because they are what a person comes back for.
 * There is no "Status" row — the headline already carries it, and every line costs in
 * something people paste into a chat.
 */
export function receiptLines(p: Payment, l: ReceiptLabels, opts: ReceiptOptions = {}): string[] {
  const brand = opts.brand ?? "MoMo›Me";
  const delivered = p.displayStatus === "Completed";
  const lines: string[] = [
    `${brand} — ${receiptTitle(p.displayStatus, l)}`,
    "",
    fill(delivered ? l.deliveredTo : l.intendedFor, { amount: xaf(p.xaf), who: recipientLine(p) }),
    `${l.fee} ${xaf(p.feeXaf)} · ${l.youPaid} ${xaf(p.totalXaf)}`,
  ];
  if (opts.includeCrypto && opts.cryptoAmount) {
    lines.push(`${l.paidWith}: ${opts.cryptoMethod ?? ""} · ${l.amountSent} ${opts.cryptoAmount}${opts.usd ? ` (${opts.usd})` : ""}`.replace(/\s+·\s+/, " · "));
  }
  lines.push("", `${l.reference}: ${p.ref}`, receiptDate(p.createdAt, opts.locale), "", l.tagline);
  return lines;
}

export function receiptText(p: Payment, l: ReceiptLabels, opts: ReceiptOptions = {}): string {
  return receiptLines(p, l, opts).join("\n");
}
