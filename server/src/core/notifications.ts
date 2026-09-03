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
  NotificationAudience, NotificationKind, NotificationRecord, Payment,
} from "../../../shared/types.js";
import { COUNTRIES } from "../../../shared/domain.js";
import { channelsFor } from "../adapters/notify.js";
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
}): Promise<NotificationRecord[]> {
  const out: NotificationRecord[] = [];
  const candidates = channelsFor(input.audience);

  if (candidates.length === 0) {
    out.push(record({
      kind: input.kind, audience: input.audience, channel: "-", to: input.to ?? "", body: input.body,
      paymentRef: input.paymentRef, status: "skipped",
      detail: `No channel can reach the ${input.audience}. We hold no contact details for them.`,
    }));
    return out;
  }

  for (const ch of candidates) {
    if (!enabledInSettings(ch.name)) {
      out.push(record({
        kind: input.kind, audience: input.audience, channel: ch.name, to: input.to ?? "", body: input.body,
        paymentRef: input.paymentRef, status: "skipped", detail: "Turned off in Settings → Notification channels.",
      }));
      continue;
    }
    if (!ch.configured()) {
      out.push(record({
        kind: input.kind, audience: input.audience, channel: ch.name, to: input.to ?? "", body: input.body,
        paymentRef: input.paymentRef, status: "skipped",
        detail: `${ch.name.toUpperCase()} is enabled in Settings but no provider is configured, so nothing was sent.`,
      }));
      continue;
    }
    const rec = record({
      kind: input.kind, audience: input.audience, channel: ch.name, to: input.to ?? "", body: input.body,
      paymentRef: input.paymentRef, status: "queued",
    });
    try {
      const r = await ch.send({ audience: input.audience, to: input.to ?? "", body: input.body });
      rec.attempts += 1;
      rec.status = r.ok ? "sent" : "failed";
      if (r.ok) rec.sentAt = new Date().toISOString();
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

/** The money landed. The one message that most needs to exist. */
export async function notifyDelivered(p: Payment): Promise<void> {
  await notify({
    kind: "payment_delivered",
    audience: "recipient",
    to: recipientMsisdn(p),
    paymentRef: p.ref,
    body: `You have received ${xaf(p.xaf)} on your ${p.recipient.provider} Mobile Money. Ref ${p.ref}. Sent via MoMo>Me.`,
  }).catch(() => { /* best-effort */ });
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
}

export async function notifyHeldForReview(p: Payment, reason: string): Promise<void> {
  await notify({
    kind: "manual_review",
    audience: "operator",
    paymentRef: p.ref,
    body: `${p.ref}: ${xaf(p.xaf)} held for review — ${reason}.`,
  }).catch(() => {});
}

/** Money arrived that nobody can account for. */
export async function notifyUnattributed(amount: number, asset: string, rail: string, ref: string): Promise<void> {
  await notify({
    kind: "unattributed_inbound",
    audience: "operator",
    body: `Unattributed ${amount} ${asset} received on ${rail} (${ref}). Held as a liability — attribute or refund it.`,
  }).catch(() => {});
}

/* ---------- reading the outbox ---------- */
export function listNotifications(limit = 100): NotificationRecord[] {
  return outbox.slice(0, limit);
}

/** What an operator needs to see at a glance: is anything silently going nowhere? */
export function notificationHealth(): {
  total: number; sent: number; failed: number; skipped: number;
  channels: Array<{ name: string; configured: boolean; enabled: boolean; reaches: NotificationAudience[] }>;
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
    })),
  };
}
