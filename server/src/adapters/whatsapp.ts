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
/** Download an inbound media object (a voice note): GET /{id} → { url, mime_type }, then the
 *  bytes from that URL with the same bearer. null when anything is off. */
export async function downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const meta = await fetchT(`${config.whatsapp.apiUrl}/${mediaId}`, { headers: { authorization: `Bearer ${config.whatsapp.accessToken}` } }, 10_000);
    if (!meta.ok) return null;
    const j = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!j.url || (j.file_size ?? 0) > 5_000_000) return null; // a voice note is ~1 KB/s; 5 MB is not one
    const bin = await fetchT(j.url, { headers: { authorization: `Bearer ${config.whatsapp.accessToken}` } }, 15_000);
    if (!bin.ok) return null;
    return { bytes: Buffer.from(await bin.arrayBuffer()), mime: j.mime_type ?? "" };
  } catch { return null; }
}

/** Meta's status callbacks for messages WE sent: sent → delivered → read, or failed with
 *  an error (131047 = re-engagement: outside the 24 h window; 131026 = not a WhatsApp
 *  number; 130472 = user's number is part of an experiment…). Returns them normalised. */
export function statusUpdates(body: unknown): Array<{ id: string; status: "sent" | "delivered" | "read" | "failed"; detail?: string; recipient?: string }> {
  const out: Array<{ id: string; status: "sent" | "delivered" | "read" | "failed"; detail?: string; recipient?: string }> = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<Record<string, unknown>> } }> }> })?.entry ?? [];
  for (const e of entries) for (const c of e.changes ?? []) for (const st of c.value?.statuses ?? []) {
    const id = String(st.id ?? ""); const status = String(st.status ?? "");
    if (!id || !["sent", "delivered", "read", "failed"].includes(status)) continue;
    const errs = (st.errors as Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }> | undefined) ?? [];
    const detail = status === "failed" ? errs.map((x) => `${x.code ?? ""} ${x.title ?? x.message ?? ""}${x.error_data?.details ? ` — ${x.error_data.details}` : ""}`.trim()).join("; ") || "delivery failed" : undefined;
    out.push({ id, status: status as "sent" | "delivered" | "read" | "failed", detail, recipient: typeof st.recipient_id === "string" ? st.recipient_id : undefined });
  }
  return out;
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
    // Outside the window Meta delivers templates only. Each notice kind has a template slot
    // (approved separately on Meta); French bodies use the French template language when
    // one is configured. Anything without a template is recorded skipped-with-reason
    // rather than sent into a void.
    const tpl = msg.kind === "payment_delivered" ? config.whatsapp.templateDelivered
      : msg.kind === "refund_needed" || msg.kind === "payment_failed" ? config.whatsapp.templateRefund
      : msg.kind === "manual_review" ? config.whatsapp.templateReview : "";
    if (tpl) {
      const amount = msg.body.match(/(\d[\d  ]*\d)\s*XAF/)?.[1]?.replace(/\s/g, " ") ?? "";
      const ref = msg.body.match(/MMM-\d{4}-\d+/)?.[0] ?? "";
      const french = /\b(Livré|Réf|remboursement|vérifi|reçu)\b/i.test(msg.body);
      const lang = french && config.whatsapp.templateLangFr ? config.whatsapp.templateLangFr : config.whatsapp.templateLang;
      return sendTemplate(to, tpl, lang, [amount ? `${amount} XAF` : "", ref]);
    }
    return { ok: false, detail: `Outside WhatsApp's 24 h reply window and no approved template for "${msg.kind ?? "this message"}" — not sent. The person can message our number to open the window, or set WHATSAPP_TEMPLATE_* on the server.` };
  },
};
