/* ============================================================
   MTN Mobile Money — COLLECTION through MTN's own API (MoMo Developer portal).

   Today a collection reaches an MTN wallet through an aggregator. This adapter is the
   direct route: MTN's Collection product, which exists precisely so a business can be paid
   for goods and services into its own collection account.

   The documented shape, and nothing beyond it:
     • auth      POST {base}/collection/token/          Basic(apiUser:apiKey) + subscription
                                                        key → an access token with expires_in
     • request   POST {base}/collection/v1_0/requesttopay
                 headers: X-Reference-Id (OUR uuid — the idempotency key), X-Target-Environment,
                          Ocp-Apim-Subscription-Key, Authorization: Bearer, X-Callback-Url?
                 body:    amount, currency, externalId, payer{partyIdType:"MSISDN",partyId},
                          payerMessage, payeeNote
                 → 202 Accepted. The payer then approves on their own handset.
     • status    GET  {base}/collection/v1_0/requesttopay/{X-Reference-Id}
                 → { status: "PENDING" | "SUCCESSFUL" | "FAILED", ... }

   Rules this file holds to:
     • Nothing undocumented is inferred. An unrecognised status is PENDING, never success.
     • X-Reference-Id IS our idempotency key, so a retried request is the same request.
     • No PIN is ever requested, seen or stored — authorisation happens on the payer's phone
       inside MTN's own flow.
     • Unconfigured → `configured()` is false and the registry never selects it. There is no
       "simulate" path here: simulation belongs to the sandbox rail, not to a real operator.

   OPERATOR-OWNED, before this can move real money: a commercial collection account with MTN,
   the production target environment name MTN assigns, a callback host MTN will post to, and
   confirmation of the limits and fees that apply to that account.
   ============================================================ */
import { createHash } from "node:crypto";
import type { CountryCode, ProviderId } from "../../../shared/types.js";
import { config, mtnCollectConfigured, mtnCollectLive } from "../config.js";
import { fetchT } from "./http.js";
import type { CollectAdapter, CollectRequest, CollectResult, CollectStatus } from "./collect.js";

const base = () => config.mtnCollect.apiUrl.replace(/\/$/, "");
const sub = () => config.mtnCollect.subscriptionKey;

/* ---- token: cached until shortly before it expires ---- */
let token: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;
async function accessToken(): Promise<string | null> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  if (inflight) return inflight;                       // single-flight: one token fetch, not one per call
  inflight = (async () => {
    try {
      const basic = Buffer.from(`${config.mtnCollect.apiUser}:${config.mtnCollect.apiKey}`).toString("base64");
      const res = await fetchT(`${base()}/collection/token/`, {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "Ocp-Apim-Subscription-Key": sub(), "content-length": "0" },
      }, 12_000);
      if (!res.ok) { console.warn(`[mtn-collect] token ${res.status}`); return null; }
      const d = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!d.access_token) return null;
      token = { value: d.access_token, expiresAt: Date.now() + Math.max(60, Number(d.expires_in ?? 3600)) * 1000 };
      return token.value;
    } catch (e) { console.warn("[mtn-collect] token error", e instanceof Error ? e.message : e); return null; }
    finally { inflight = null; }
  })();
  return inflight;
}

/** MTN identifies a payer by MSISDN in international form without a leading +. */
function msisdn(phone: string, country: CountryCode): string {
  const d = phone.replace(/\D/g, "");
  if (d.length > 9) return d;                       // already carries a country code
  const dial = country === "CM" ? "237" : "";
  return `${dial}${d}`;
}

/** Our idempotency key becomes MTN's X-Reference-Id, which must be a UUID. A key that is
 *  already a UUID is used as-is; anything else is mapped to a STABLE uuid derived from it,
 *  so the same key always yields the same reference — that is what makes a retry a retry. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refs = new Map<string, string>();
export function referenceFor(key: string): string {
  if (UUID_RE.test(key)) return key;
  let r = refs.get(key);
  if (!r) {
    // Deterministic v5-style derivation: same key in, same uuid out, across restarts.
    const h = createHash("sha1").update(`momome:mtn-collect:${key}`).digest("hex");
    r = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    refs.set(key, r);
  }
  return r;
}

const mtnCollector: CollectAdapter = {
  name: "mtn",
  // Preferred over an aggregator when it is configured: one hop fewer, and the operator's
  // own record is the one a customer's support call will be answered from.
  priority: 5,
  configured: mtnCollectConfigured,
  live: mtnCollectLive,
  supports: (provider: ProviderId, country: CountryCode) => provider === "MTN" && country === "CM",

  async collect(req: CollectRequest): Promise<CollectResult> {
    const t = await accessToken();
    if (!t) throw new Error("MTN collection unavailable: could not obtain an access token");
    const reference = referenceFor(req.idempotencyKey);
    const res = await fetchT(`${base()}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${t}`,
        "X-Reference-Id": reference,
        "X-Target-Environment": config.mtnCollect.targetEnvironment,
        "Ocp-Apim-Subscription-Key": sub(),
        "content-type": "application/json",
        ...(config.mtnCollect.callbackUrl ? { "X-Callback-Url": config.mtnCollect.callbackUrl } : {}),
      },
      body: JSON.stringify({
        amount: String(req.xaf),
        currency: config.mtnCollect.currency,
        externalId: req.idempotencyKey,
        payer: { partyIdType: "MSISDN", partyId: msisdn(req.phone, req.country) },
        payerMessage: (req.narration ?? "Payment").slice(0, 160),
        payeeNote: (req.name ?? "MoMo›Me").slice(0, 160),
      }),
    }, 15_000);
    // 202 = with the payer. 409 = this reference already exists, which for us is the same
    // request arriving twice — the caller must not treat it as a second debit.
    if (res.status === 409) return { status: "duplicate", providerRef: reference, simulated: false };
    if (res.status !== 202 && !res.ok) throw new Error(`MTN collection failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { status: "accepted", providerRef: reference, simulated: false };
  },

  async status(idempotencyKey: string): Promise<CollectStatus | null> {
    const t = await accessToken();
    if (!t) return null;
    try {
      const res = await fetchT(`${base()}/collection/v1_0/requesttopay/${referenceFor(idempotencyKey)}`, {
        headers: { authorization: `Bearer ${t}`, "X-Target-Environment": config.mtnCollect.targetEnvironment, "Ocp-Apim-Subscription-Key": sub() },
      }, 12_000);
      if (res.status === 404) return null;          // unknown to MTN — not a failure, just unknown
      if (!res.ok) return null;
      const d = (await res.json()) as { status?: string };
      const s = String(d.status ?? "").toUpperCase();
      if (s === "SUCCESSFUL") return "COMPLETED";
      if (s === "FAILED" || s === "REJECTED" || s === "TIMEOUT" || s === "EXPIRED") return "FAILED";
      // PENDING, ONGOING, or anything this adapter does not know: the payer has not
      // decided as far as we can prove. Never optimistic.
      return "PENDING";
    } catch { return null; }
  },

  async health() {
    if (!mtnCollectConfigured()) return { ok: false, note: "not configured" };
    const t = await accessToken();
    return t ? { ok: true } : { ok: false, note: "token endpoint did not answer" };
  },
};

export default mtnCollector;
export { mtnCollector };
