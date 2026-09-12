/* ============================================================
   Notification outbox — what we told people, and what we didn't.

   The admin console has always carried a card headed "Notification channels — how customers
   receive transfer updates", with Email and SMS switched ON. Nothing on the server ever read
   that setting. No customer was ever sent anything, and there was no email or SMS provider in
   the dependency tree to send with. An operator reading that screen had every reason to
   believe recipients were being told their money had arrived.

   This is the pipeline behind it. Two things matter about the design:

   It is an OUTBOX, not fire-and-forget. Every attempt is recorded — sent, failed, or skipped
   — so "did the recipient get told?" has an answer. A channel that is switched on in settings
   but has no provider configured records a `skipped` with that as the reason, which is how
   the console stops implying something it isn't doing.

   It never breaks a payment. Dispatch is best-effort and swallows its own errors: a payment
   that has been delivered has been delivered, whether or not an SMS gateway answered.
   ============================================================ */
import type {
  NotificationAudience, NotificationKind, NotificationRecord, Payment, DeletionRequest, TestReport,
} from "../../../shared/types.js";
import { COUNTRIES } from "../../../shared/domain.js";
import { channelsFor, smsChannel } from "../adapters/notify.js";
import { pushTokenFor, pushTokenCount } from "./pushTokens.js";
import { getSettings } from "./settings.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";

const CAP = 500; // newest-first ring; the outbox is an operational record, not an archive
const outbox: NotificationRecord[] = [];

register(
  "notifications",
  () => outbox.slice(0, CAP),
  (d: NotificationRecord[]) => { outbox.length = 0; outbox.push(...d); },
);

/** Which settings toggle governs a channel. The console speaks in Email/SMS/WhatsApp; the
 *  registry speaks in channel names. `log` is not a customer channel and is never gated —
 *  it is how an operator sees what happened. */
function enabledInSettings(channel: string): boolean {
  const ch = getSettings().channels;
  if (channel === "sms") return ch.SMS;
  if (channel === "email") return ch.Email;
  if (channel === "whatsapp") return ch.WhatsApp;
  if (channel === "push") return ch.Push !== false;
  return true;
}

function record(r: Omit<NotificationRecord, "id" | "createdAt" | "attempts">): NotificationRecord {
  const rec: NotificationRecord = { id: id("ntf"), createdAt: new Date().toISOString(), attempts: 0, ...r };
  outbox.unshift(rec);
  if (outbox.length > CAP) outbox.length = CAP;
  touch("notifications");
  return rec;
}

/**
 * Send one message to one audience, recording every outcome.
 *
 * Best-effort by construction: the caller is on a money path and must not be able to fail
 * because a gateway is down. Every channel that could serve the audience is tried, and the
 * ones that couldn't are written down with the reason — an operator asking "why didn't the
 * recipient get an SMS?" gets "SMS is enabled but no provider is configured" rather than
 * silence.
 */
export async function notify(input: {
  kind: NotificationKind;
  audience: NotificationAudience;
  to?: string;
  body: string;
  paymentRef?: string;
  /** What to write in the outbox INSTEAD of the body. One-time codes are sent but never
   *  recorded: the outbox is readable by every operator with the notifications section, and
   *  a stored OTP is a stored ability to complete somebody else's verification. */
  recordAs?: string;
}): Promise<NotificationRecord[]> {
  const logged = input.recordAs ?? input.body;
  const out: NotificationRecord[] = [];
  const candidates = channelsFor(input.audience);

  if (candidates.length === 0) {
    out.push(record({
      kind: input.kind, audience: input.audience, channel: "-", to: input.to ?? "", body: logged,
      paymentRef: input.paymentRef, status: "skipped",
      detail: `No channel can reach the ${input.audience}. We hold no contact details for them.`,
    }));
    return out;
  }

  let deliveredOverWhatsApp = false;
  for (const ch of candidates) {
    // Same person, same news: a delivery notice that already landed on WhatsApp does not
    // also need to cost an SMS. Recorded as skipped so the outbox still tells the story.
    if (ch.name === "sms" && deliveredOverWhatsApp) {
      out.push(record({ kind: input.kind, audience: input.audience, channel: ch.name, to: input.to ?? "", body: logged, paymentRef: input.paymentRef, status: "skipped", detail: "Already delivered over WhatsApp — SMS not needed." }));
      continue;
    }
    if (!enabledInSettings(ch.name)) {
      out.push(record({
        kind: input.kind, audience: input.audience, channel: ch.name, to: input.to ?? "", body: logged,
        paymentRef: input.paymentRef, status: "skipped", detail: "Turned off in Settings → Notification channels.",
      }));
      continue;
    }
    const why = ch.unreachable?.({ audience: input.audience, to: input.to ?? "", body: input.body });
    if (why) {
      out.push(record({
        kind: input.kind, audience: input.audience, channel: ch.name, to: input.to ?? "", body: logged,
        paymentRef: input.paymentRef, status: "skipped", detail: why,
      }));
      continue;
    }
    if (!ch.configured()) {
      out.push(record({
        kind: input.kind, audience: input.audience, channel: ch.name, to: input.to ?? "", body: logged,
        paymentRef: input.paymentRef, status: "skipped",
        detail: `${ch.name.toUpperCase()} is enabled in Settings but no provider is configured, so nothing was sent.`,
      }));
      continue;
    }
    const rec = record({
      kind: input.kind, audience: input.audience, channel: ch.name, to: input.to ?? "", body: logged,
      paymentRef: input.paymentRef, status: "queued",
    });
    try {
      const r = await ch.send({ audience: input.audience, kind: input.kind, to: input.to ?? "", body: input.body });
      rec.attempts += 1;
      rec.status = r.ok ? "sent" : "failed";
      if (r.ok) { rec.sentAt = new Date().toISOString(); rec.deliveryStatus = "sent"; }
      if (r.id) rec.providerMessageId = r.id;
      if (r.ok && ch.name === "whatsapp") deliveredOverWhatsApp = true;
      if (r.detail) rec.detail = r.detail;
    } catch (e) {
      // A channel that throws is a channel failure, never a payment failure.
      rec.attempts += 1;
      rec.status = "failed";
      rec.detail = e instanceof Error ? e.message : "send threw";
    }
    touch("notifications");
    out.push(rec);
  }
  return out;
}

/** A channel provider reported what happened to a message it carried (WhatsApp statuses:
 *  sent → delivered → read, or failed with a reason). Updates the record so the outbox
 *  answers "did they GET it?", not only "did we send it?". */
export function updateDelivery(providerMessageId: string, status: "sent" | "delivered" | "read" | "failed", detail?: string): boolean {
  const rec = outbox.find((r) => r.providerMessageId === providerMessageId);
  if (!rec) return false;
  // never regress read → delivered → sent
  const rank = { sent: 1, delivered: 2, read: 3, failed: 9 } as const;
  if (rec.deliveryStatus && rank[rec.deliveryStatus] > rank[status] && status !== "failed") return true;
  rec.deliveryStatus = status;
  if (status === "failed") { rec.status = "failed"; rec.detail = detail ?? "provider reported delivery failure"; }
  else if (detail) rec.detail = detail;
  touch("notifications");
  return true;
}

/* ---------- the messages themselves ----------
   Written for the person receiving them, not for the system sending them. A recipient in
   Douala gets a text on a feature phone: it has to say who paid, how much, and the
   reference, in the first line, with no jargon and nothing to tap. */

const xaf = (n: number): string => `${Math.round(n).toLocaleString("en-US").replace(/,/g, " ")} XAF`;

/** International number for the recipient's own operator. */
function recipientMsisdn(p: Payment): string {
  const dial = COUNTRIES[p.recipient.country]?.dial ?? "";
  const digits = p.recipient.phone.replace(/\D/g, "");
  return `${dial}${digits}`.replace(/\s+/g, "");
}

/** Sender-facing copy in the language the device registered with. First line = title. */
function senderLang(p: Payment): "en" | "fr" { return (p.senderId && pushTokenFor(p.senderId)?.lang) || "en"; }
const who = (p: Payment): string => (p.recipient.name && p.recipient.name.replace(/\D/g, "") !== p.recipient.phone.replace(/\D/g, "") ? p.recipient.name : `${p.recipient.provider} ${p.recipient.phone}`);

/** The money landed. The one message that most needs to exist — for BOTH sides. */
export async function notifyDelivered(p: Payment): Promise<void> {
  await notify({
    kind: "payment_delivered",
    audience: "recipient",
    to: recipientMsisdn(p),
    paymentRef: p.ref,
    body: `You have received ${xaf(p.xaf)} on your ${p.recipient.provider} Mobile Money. Ref ${p.ref}. Sent via MoMo>Me.`,
  }).catch(() => { /* best-effort */ });
  if (p.senderId && !p.senderId.startsWith("lnurl:")) {
    const fr = senderLang(p) === "fr";
    await notify({
      kind: "payment_delivered", audience: "sender", to: p.senderId, paymentRef: p.ref,
      body: fr ? `Livré ✓\n${xaf(p.xaf)} envoyés à ${who(p)} · Réf ${p.ref}` : `Delivered ✓\n${xaf(p.xaf)} sent to ${who(p)} · Ref ${p.ref}`,
    }).catch(() => {});
  }
}

/** It did not land. There is no sender contact — the account is a device — so this is an
 *  operator alert, and the sender learns of it in the app's refund-claim flow. */
export async function notifyPayoutFailed(p: Payment, reason: string): Promise<void> {
  await notify({
    kind: "payment_failed",
    audience: "operator",
    paymentRef: p.ref,
    body: `${p.ref}: payout of ${xaf(p.xaf)} to ${p.recipient.provider} ${p.recipient.phone} FAILED — ${reason}. A refund is owed.`,
  }).catch(() => {});
  // The sender has money to claim back — that is worth a push even more than a delivery.
  if (p.senderId && !p.senderId.startsWith("lnurl:")) {
    const fr = senderLang(p) === "fr";
    await notify({
      kind: "refund_needed", audience: "sender", to: p.senderId, paymentRef: p.ref,
      body: fr ? `Paiement non livré\n${xaf(p.xaf)} pour ${who(p)} n'a pas pu être livré. Ouvrez l'app pour récupérer votre remboursement · Réf ${p.ref}` : `Payment not delivered\n${xaf(p.xaf)} for ${who(p)} could not be delivered. Open the app to claim your refund · Ref ${p.ref}`,
    }).catch(() => {});
  }
}

export async function notifyHeldForReview(p: Payment, reason: string): Promise<void> {
  await notify({
    kind: "manual_review",
    audience: "operator",
    paymentRef: p.ref,
    body: `${p.ref}: ${xaf(p.xaf)} held for review — ${reason}.`,
  }).catch(() => {});
  if (p.senderId && !p.senderId.startsWith("lnurl:")) {
    const fr = senderLang(p) === "fr";
    await notify({
      kind: "manual_review", audience: "sender", to: p.senderId, paymentRef: p.ref,
      body: fr ? `Paiement en vérification\n${xaf(p.xaf)} pour ${who(p)} est vérifié par notre équipe. Vous serez prévenu dès que c'est réglé · Réf ${p.ref}` : `Payment being checked\n${xaf(p.xaf)} for ${who(p)} is being checked by our team. You will be told as soon as it is settled · Ref ${p.ref}`,
    }).catch(() => {});
  }
}

/** Money arrived that nobody can account for. */
export async function notifyUnattributed(amount: number, asset: string, rail: string, ref: string): Promise<void> {
  await notify({
    kind: "unattributed_inbound",
    audience: "operator",
    body: `Unattributed ${amount} ${asset} received on ${rail} (${ref}). Held as a liability — attribute or refund it.`,
  }).catch(() => {});
}

/** Someone asked for their account to go, from a device that cannot prove it is theirs.
 *  The request is on record (core/deletionRequests); this makes sure a person sees it. */
export async function notifyDeletionRequest(r: DeletionRequest): Promise<void> {
  await notify({
    kind: "deletion_request",
    audience: "operator",
    body: `${r.ref}: account deletion requested for ${COUNTRIES[r.country]?.dial ?? ""} ${r.phone} from a device we could not verify. Verify ownership and answer it within 30 days — Admin → Deletion requests.`,
  }).catch(() => {});
}

/** A tester filed a checklist run. The operator is told at once, with the failures in the
 *  body, so a run full of red does not sit unread until someone opens the Testing page. */
export async function notifyTestReport(r: TestReport, failedTitles: string[]): Promise<void> {
  const fails = failedTitles.length ? ` Failed: ${failedTitles.slice(0, 5).join("; ")}${failedTitles.length > 5 ? "…" : ""}.` : " Nothing failed.";
  await notify({
    kind: "test_report",
    audience: "operator",
    body: `${r.ref}: ${r.name} (${COUNTRIES[r.country]?.dial ?? ""} ${r.phone}) tested ${r.platform}${r.build ? ` build ${r.build}` : ""}: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped.${fails} Admin → Testing.`,
  }).catch(() => {});
}

/** Can we actually deliver an SMS right now? One source of truth, so a flow that depends on
 *  a code arriving cannot be enabled by a flag while the channel behind it is unwired. */
export function canSendSms(): boolean {
  return smsChannel.configured() && getSettings().channels.SMS;
}

/** Send a one-time code, and say whether it actually went.
 *
 *  Merchant verification used to call requestAnchor(), which only GENERATES a code, and then
 *  answer `{ sent: true }`. Nothing was ever sent. In production the dev code is withheld, so
 *  the merchant waited for an SMS that did not exist, never reached verifiedPhone, and could
 *  never create a pay link — the whole merchant flow dead-ended on a message that was never
 *  dispatched. The code is sent but NOT recorded: see `recordAs`. */
export async function sendOtpSms(to: string, code: string, purpose: string): Promise<boolean> {
  if (!canSendSms()) return false;
  const recs = await notify({
    kind: "manual_review", // operational, not a payment event
    audience: "recipient",
    to,
    body: `${code} is your MoMo>Me code to ${purpose}. It expires in 5 minutes. Never share it.`,
    recordAs: `One-time code sent to ${to} (${purpose}). The code itself is not recorded.`,
  }).catch(() => []);
  return recs.some((r) => r.status === "sent");
}

/* ---------- reading the outbox ---------- */
export function listNotifications(limit = 100): NotificationRecord[] {
  return outbox.slice(0, limit);
}

/** What an operator needs to see at a glance: is anything silently going nowhere? */
export function notificationHealth(): {
  total: number; sent: number; failed: number; skipped: number;
  channels: Array<{ name: string; configured: boolean; enabled: boolean; reaches: NotificationAudience[]; devices?: number }>;
} {
  const all: NotificationAudience[] = ["recipient", "sender", "operator"];
  return {
    total: outbox.length,
    sent: outbox.filter((r) => r.status === "sent").length,
    failed: outbox.filter((r) => r.status === "failed").length,
    skipped: outbox.filter((r) => r.status === "skipped").length,
    channels: [...new Set(all.flatMap((a) => channelsFor(a)))].map((c) => ({
      name: c.name,
      configured: c.configured(),
      enabled: enabledInSettings(c.name),
      reaches: all.filter((a) => c.supports(a)),
      // Push is "configured" by construction; what matters is how many devices opted in.
      ...(c.name === "push" ? { devices: pushTokenCount() } : {}),
    })),
  };
}
