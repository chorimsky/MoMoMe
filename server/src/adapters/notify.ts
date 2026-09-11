/* ============================================================
   Notification channels — a registry, in the same shape as the payout rails.

   A channel declares whether it is configured and which audiences it can reach, and the
   dispatcher picks from what is actually available. That matters more here than it looks:
   the audiences are not interchangeable. We hold the RECIPIENT's phone number, so SMS can
   reach them. We hold nothing for the sender but a device id — the account IS the device,
   there is no sign-up — so only push can reach them, and only once a token is registered.
   A channel that claims an audience it cannot serve would produce messages that silently
   go nowhere, which is the failure this whole change exists to end.

   ADD A CHANNEL: implement NotifyChannel and append it to CHANNELS.
   ============================================================ */
import type { NotificationAudience } from "../../../shared/types.js";
import { fetchT } from "./http.js";
import { pushTokenFor, dropDeadToken } from "../core/pushTokens.js";
import { whatsappChannel } from "./whatsapp.js";

export interface OutboundMessage {
  audience: NotificationAudience;
  /** Phone in international form for SMS; empty for operator messages. */
  to: string;
  body: string;
}

export interface NotifyChannel {
  /** Stable id, and the name shown against a record in the outbox. */
  readonly name: string;
  /** Credentials/endpoint present → this channel can actually deliver. */
  configured(): boolean;
  /** Which audiences it can physically reach. */
  supports(audience: NotificationAudience): boolean;
  /** OPTIONAL: a reason this particular `to` cannot be reached right now (no token, no
   *  number). Recorded as SKIPPED — "nothing could carry it" — rather than as a failed
   *  send, which would read as a gateway fault. */
  unreachable?(msg: OutboundMessage): string | undefined;
  /** Deliver. Never throws — a channel failure must not take down a payment. */
  send(msg: OutboundMessage): Promise<{ ok: boolean; detail?: string }>;
}

/* ---------- operator log ----------
   Always available, and deliberately so: it means the pipeline is never a no-op, every
   event leaves a trace an operator can find, and the outbox proves end to end that
   dispatch runs — independent of whether anyone has bought an SMS bundle yet. */
export const logChannel: NotifyChannel = {
  name: "log",
  configured: () => true,
  supports: (a) => a === "operator",
  send: async (msg) => {
    console.warn(`[notify] ${msg.body}`);
    return { ok: true };
  },
};

/* ---------- SMS over a configured HTTP endpoint ----------
   Deliberately provider-agnostic. Every SMS gateway in this market — and the aggregators
   that front them — speaks HTTP with a JSON body; hard-coding one vendor's SDK would make
   the choice for an operator who has to pick on price and delivery rates locally. Point
   SMS_WEBHOOK_URL at the gateway (or a one-line relay that reshapes the payload) and it
   sends. Unset, it reports itself unconfigured, which is what the console then shows. */
export const smsChannel: NotifyChannel = {
  name: "sms",
  configured: () => !!(process.env.SMS_WEBHOOK_URL ?? "").trim(),
  supports: (a) => a === "recipient",
  send: async (msg) => {
    const url = (process.env.SMS_WEBHOOK_URL ?? "").trim();
    if (!url) return { ok: false, detail: "SMS_WEBHOOK_URL is not set." };
    if (!msg.to) return { ok: false, detail: "No destination number." };
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const auth = (process.env.SMS_WEBHOOK_AUTH ?? "").trim();
      if (auth) headers.authorization = auth;
      const res = await fetchT(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: msg.to, message: msg.body }),
      });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 200);
        return { ok: false, detail: `gateway ${res.status}${text ? `: ${text}` : ""}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "send failed" };
    }
  },
};

/** Every known channel. */
/* ---------- push, through the Expo push service ----------
   The only channel that can reach a SENDER (the account is a device). `to` is the sender
   id; the token registered by that device is looked up here. The Expo push service needs
   no credential from us (an optional EXPO_ACCESS_TOKEN raises the rate limit); APNs and
   FCM credentials live on the EAS project, not in this server. */
export const pushChannel: NotifyChannel = {
  name: "push",
  configured: () => true,
  supports: (a) => a === "sender",
  unreachable: (msg) => (pushTokenFor(msg.to) ? undefined : "We hold no contact details for the sender beyond a device id, and this device has not turned on payment alerts (no push token registered)."),
  send: async (msg) => {
    const rec = pushTokenFor(msg.to);
    if (!rec) return { ok: false, detail: "no push token" };
    const [title, ...rest] = msg.body.split("\n");
    const body = rest.join("\n") || title;
    try {
      const res = await fetchT("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify([{ to: rec.token, title: rest.length ? title : "MoMo›Me", body, sound: "default", priority: "high", channelId: "payments", data: { kind: "payment" } }]),
      }, 10_000);
      const j = (await res.json().catch(() => ({}))) as { data?: Array<{ status?: string; message?: string; details?: { error?: string } }> };
      const ticket = j.data?.[0];
      if (!res.ok || !ticket) return { ok: false, detail: `Expo push HTTP ${res.status}` };
      if (ticket.status === "ok") return { ok: true };
      if (ticket.details?.error === "DeviceNotRegistered") { dropDeadToken(rec.token); return { ok: false, detail: "Token no longer valid (app uninstalled or alerts revoked) — dropped." }; }
      return { ok: false, detail: `${ticket.details?.error ?? "error"}: ${ticket.message ?? ""}`.trim() };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "push send failed" };
    }
  },
};

export const CHANNELS: NotifyChannel[] = [logChannel, whatsappChannel, smsChannel, pushChannel];

export function channelByName(name: string): NotifyChannel | undefined {
  return CHANNELS.find((c) => c.name === name);
}

/** Channels that could carry a message to this audience, configured or not — the caller
 *  needs the unconfigured ones too, so it can record WHY nothing was sent. */
export function channelsFor(audience: NotificationAudience): NotifyChannel[] {
  return CHANNELS.filter((c) => c.supports(audience));
}
