/* ============================================================
   WhatsApp Business Cloud API — one client, one notification channel.

   Send: POST {apiUrl}/{phoneNumberId}/messages with a bearer token. Text inside the 24 h
   reply window; an approved template outside it (Meta delivers nothing else). Errors come
   back as { error: { message, code } } and are surfaced verbatim in the outbox so an
   operator can read "template not found" instead of "failed".
   ============================================================ */
import { fetchT } from "./http.js";
import { config, whatsappConfigured } from "../config.js";
import type { NotifyChannel } from "./notify.js";
import { inReplyWindow, waDigits } from "../core/whatsapp.js";
import { accountOf } from "../core/account.js";

type SendResult = { ok: boolean; detail?: string; id?: string };

async function post(body: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetchT(`${config.whatsapp.apiUrl}/${config.whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.whatsapp.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
    }, 10_000);
    const j = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
    if (!res.ok) return { ok: false, detail: `WhatsApp ${res.status}: ${j.error?.message ?? "error"}${j.error?.code ? ` (${j.error.code})` : ""}` };
    return { ok: true, id: j.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "WhatsApp send failed" };
  }
}

export function sendText(to: string, body: string): Promise<SendResult> {
  return post({ to: waDigits(to), type: "text", text: { preview_url: true, body } });
}
export function sendTemplate(to: string, name: string, lang: string, params: string[]): Promise<SendResult> {
  return post({ to: waDigits(to), type: "template", template: { name, language: { code: lang },
    components: params.length ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] : [] } });
}
/** Mark an inbound message as read (the two blue ticks) — a courtesy, best-effort. */
export function markRead(messageId: string): Promise<SendResult> {
  return post({ status: "read", message_id: messageId });
}

/** The sender's phone, when their device anchored to one ("Your number"). The only way a
 *  sender is reachable on WhatsApp — the account is otherwise just a device id. */
function senderPhone(senderId: string): string | null {
  const acct = accountOf(senderId); // "acct:<digits>"
  return acct?.startsWith("acct:") ? acct.slice(5) : null;
}

export const whatsappChannel: NotifyChannel = {
  name: "whatsapp",
  configured: () => whatsappConfigured(),
  supports: (a) => a === "recipient" || a === "sender",
  unreachable: (msg) => {
    if (msg.audience === "sender" && !senderPhone(msg.to)) return "The sender has not linked a phone number (More → Your number), so there is no WhatsApp to reach.";
    return undefined;
  },
  send: async (msg) => {
    const to = msg.audience === "sender" ? senderPhone(msg.to) ?? "" : msg.to;
    if (!to) return { ok: false, detail: "no phone" };
    if (inReplyWindow(to)) return sendText(to, msg.body);
    // Outside the window Meta delivers templates only. Delivery notices have a template
    // slot; everything else is recorded as skipped-with-reason rather than sent into a void.
    const tpl = config.whatsapp.templateDelivered;
    if (tpl && /^(Delivered|Livré|You have received)/i.test(msg.body)) {
      const amount = msg.body.match(/(\d[\d  ]*\d)\s*XAF/)?.[1]?.replace(/\s/g, " ") ?? "";
      const ref = msg.body.match(/MMM-\d{4}-\d+/)?.[0] ?? "";
      return sendTemplate(to, tpl, config.whatsapp.templateLang, [amount ? `${amount} XAF` : "", ref]);
    }
    return { ok: false, detail: "Outside WhatsApp's 24 h reply window and no approved template for this message — not sent. The person can message our number to open the window." };
  },
};
