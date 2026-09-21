/* ============================================================
   Developer-platform email — verification, password reset, invitations, live-access replies.

   Provider: any Resend-compatible HTTP API (POST {EMAIL_API_URL} with {from,to,subject,text,html}
   and `Authorization: Bearer EMAIL_API_KEY`). Configure:
     EMAIL_API_KEY=re_…            EMAIL_FROM="MoMo›Me Developers <developers@momome.xyz>"
     EMAIL_API_URL=https://api.resend.com/emails   (default)
   Unconfigured: nothing is sent; in the sandbox/local environment the action link is returned
   to the caller as `dev_link` so the flow can be exercised without a provider. In live the
   link is never returned — the operator can complete the action from Admin → API Platform.
   Every send is recorded in the outbox (last 500) for support.
   ============================================================ */
import { fetchT } from "../../adapters/http.js";
import { register, touch } from "../persist.js";
import { liveMoney } from "../../config.js";

export interface EmailRecord { id: string; at: string; to: string; subject: string; kind: string; status: "sent" | "failed" | "unconfigured"; error?: string }
const outbox: EmailRecord[] = [];
register("platform_email_outbox", () => outbox.slice(-500), (d: EmailRecord[]) => { outbox.length = 0; outbox.push(...d); });

export const emailConfigured = () => !!process.env.EMAIL_API_KEY && !!process.env.EMAIL_FROM;
/** Dev links may be shown to the caller only where no real money exists. */
export const devLinksAllowed = () => !liveMoney();

export async function sendEmail(kind: string, to: string, subject: string, text: string, html?: string): Promise<EmailRecord> {
  const rec: EmailRecord = { id: `eml_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), to, subject, kind, status: "unconfigured" };
  if (emailConfigured()) {
    try {
      const res = await fetchT(process.env.EMAIL_API_URL ?? "https://api.resend.com/emails", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EMAIL_API_KEY}` }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }) }, 10_000);
      if (res.ok) rec.status = "sent"; else { rec.status = "failed"; rec.error = `HTTP ${res.status}`; }
    } catch (e) { rec.status = "failed"; rec.error = e instanceof Error ? e.message : "send failed"; }
  } else console.log(`[email:${kind}] (unconfigured) to ${to}: ${subject}\n${text}`);
  outbox.push(rec); if (outbox.length > 600) outbox.splice(0, outbox.length - 500); touch("platform_email_outbox");
  return rec;
}
export const emailOutbox = (limit = 100) => outbox.slice(-limit).reverse();
