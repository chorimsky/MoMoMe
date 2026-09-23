/* ============================================================
   Orange Money — COLLECTION through Orange's own Web Payment API.

   Orange's e-merchant proposition is a HOSTED payment: we ask Orange for a payment, Orange
   returns a URL, the customer completes the payment on Orange's own page (where the PIN is
   entered — never here), and the transaction status endpoint is what settles it.

   That difference matters to the rest of the system: unlike MTN's request-to-pay, which
   rings the payer's handset, this rail hands back a URL the customer must be sent to. The
   adapter surfaces that as `paymentUrl` on the result, and a caller that cannot redirect
   (an SMS-only flow, say) should not select this rail.

   The documented shape, and nothing beyond it:
     • auth     POST {base}/oauth/v3/token            client_credentials → access_token
     • create   POST {base}/orange-money-webpay/{country}/v1/webpayment
                body: merchant_key, currency, order_id, amount, return_url, cancel_url,
                      notif_url, lang, reference
                → { payment_url, pay_token, notif_token, status }
     • status   POST {base}/orange-money-webpay/{country}/v1/transactionstatus
                body: order_id, amount, pay_token → { status: "SUCCESS"|"PENDING"|"FAILED"|… }

   Rules this file holds to:
     • Only documented fields are sent and only documented statuses are trusted; anything
       else reads as PENDING, never as success.
     • `order_id` IS our idempotency key, and the pay_token for a key is remembered, so a
       retry re-uses the same Orange transaction rather than opening a second one.
     • No PIN is ever requested, seen or stored.
     • Unconfigured → `configured()` is false and the registry never selects it.

   OPERATOR-OWNED, before this can move real money: an Orange Money merchant account and
   merchant key, the production endpoints Orange assigns for the country, return/cancel/notify
   URLs registered with Orange, and confirmation of limits and fees for that account.
   ============================================================ */
import type { CountryCode, ProviderId } from "../../../shared/types.js";
import { config, orangeCollectConfigured, orangeCollectLive } from "../config.js";
import { fetchT } from "./http.js";
import type { CollectAdapter, CollectRequest, CollectResult, CollectStatus } from "./collect.js";

const base = () => config.orangeCollect.apiUrl.replace(/\/$/, "");
/** Orange scopes the web-payment path by country (lower-case ISO alpha-2). */
const webpay = (country: CountryCode) => `${base()}/orange-money-webpay/${country.toLowerCase()}/v1`;

let token: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;
async function accessToken(): Promise<string | null> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const basic = Buffer.from(`${config.orangeCollect.clientId}:${config.orangeCollect.clientSecret}`).toString("base64");
      const res = await fetchT(`${base()}/oauth/v3/token`, {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: "grant_type=client_credentials",
      }, 12_000);
      if (!res.ok) { console.warn(`[orange-collect] token ${res.status}`); return null; }
      const d = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!d.access_token) return null;
      token = { value: d.access_token, expiresAt: Date.now() + Math.max(60, Number(d.expires_in ?? 3600)) * 1000 };
      return token.value;
    } catch (e) { console.warn("[orange-collect] token error", e instanceof Error ? e.message : e); return null; }
    finally { inflight = null; }
  })();
  return inflight;
}

/** Orange returns a pay_token when the payment is created and REQUIRES it back to read the
 *  status. Remembered per idempotency key: without it a status call cannot be made at all. */
const payTokens = new Map<string, { payToken: string; xaf: number; country: CountryCode }>();
export function payTokenFor(key: string): string | undefined { return payTokens.get(key)?.payToken; }
export function _rememberPayToken(key: string, payToken: string, xaf: number, country: CountryCode): void {
  payTokens.set(key, { payToken, xaf, country });
}

/** The hosted page a customer must be sent to, once created. Exposed so a checkout can
 *  redirect; absent until `collect()` has run for that key. */
const paymentUrls = new Map<string, string>();
export function paymentUrlFor(key: string): string | undefined { return paymentUrls.get(key); }
/** Test hook, mirroring `_rememberPayToken`: seed what Orange would have handed back. */
export function _rememberPaymentUrl(key: string, url: string): void { paymentUrls.set(key, url); }

const orangeCollector: CollectAdapter = {
  name: "orange",
  priority: 5,
  configured: orangeCollectConfigured,
  live: orangeCollectLive,
  supports: (provider: ProviderId, country: CountryCode) => provider === "ORANGE" && country === "CM",

  async collect(req: CollectRequest): Promise<CollectResult> {
    // Already created for this key → the same transaction, not a second one.
    const known = payTokens.get(req.idempotencyKey);
    if (known) return { status: "duplicate", providerRef: known.payToken, simulated: false, ...(paymentUrls.get(req.idempotencyKey) ? { paymentUrl: paymentUrls.get(req.idempotencyKey) } : {}) };
    const t = await accessToken();
    if (!t) throw new Error("Orange collection unavailable: could not obtain an access token");
    const res = await fetchT(`${webpay(req.country)}/webpayment`, {
      method: "POST",
      headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        merchant_key: config.orangeCollect.merchantKey,
        currency: config.orangeCollect.currency,
        order_id: req.idempotencyKey,
        amount: req.xaf,
        return_url: config.orangeCollect.returnUrl,
        cancel_url: config.orangeCollect.cancelUrl,
        notif_url: config.orangeCollect.notifUrl,
        lang: "fr",
        reference: (req.name ?? "MoMo›Me").slice(0, 60),
      }),
    }, 15_000);
    if (!res.ok) throw new Error(`Orange collection failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const d = (await res.json()) as { payment_url?: string; pay_token?: string; status?: string };
    if (!d.pay_token) throw new Error("Orange collection failed: no pay_token in the response");
    _rememberPayToken(req.idempotencyKey, d.pay_token, req.xaf, req.country);
    if (d.payment_url) paymentUrls.set(req.idempotencyKey, d.payment_url);
    // The page the payer must complete. Handed straight back to the caller: this rail is
    // useless without it, because nothing rings the payer's handset.
    return { status: "accepted", providerRef: d.pay_token, simulated: false, ...(d.payment_url ? { paymentUrl: d.payment_url } : {}) };
  },

  async status(idempotencyKey: string): Promise<CollectStatus | null> {
    const known = payTokens.get(idempotencyKey);
    if (!known) return null;                        // never created here — nothing to report
    const t = await accessToken();
    if (!t) return null;
    try {
      const res = await fetchT(`${webpay(known.country)}/transactionstatus`, {
        method: "POST",
        headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ order_id: idempotencyKey, amount: known.xaf, pay_token: known.payToken }),
      }, 12_000);
      if (!res.ok) return null;
      const d = (await res.json()) as { status?: string };
      const s = String(d.status ?? "").toUpperCase();
      if (s === "SUCCESS" || s === "SUCCESSFULL" || s === "SUCCESSFUL") return "COMPLETED";
      if (s === "FAILED" || s === "EXPIRED" || s === "CANCELLED" || s === "CANCELED") return "FAILED";
      return "PENDING";                              // INITIATED / PENDING / anything unknown
    } catch { return null; }
  },

  async health() {
    if (!orangeCollectConfigured()) return { ok: false, note: "not configured" };
    const t = await accessToken();
    return t ? { ok: true } : { ok: false, note: "token endpoint did not answer" };
  },
};

export default orangeCollector;
export { orangeCollector };
