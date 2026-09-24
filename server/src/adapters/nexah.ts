/* ============================================================
   NEXAH BulkSMS — SMS for PHONE NUMBER VERIFICATION only.

   Scope, deliberately: this rail carries one-time codes. It is NOT registered in
   adapters/notify.ts CHANNELS, so it never picks up a payment notice; the generic
   SMS_WEBHOOK_URL channel keeps doing that job. Verification is the flow that fails
   hardest when SMS fails — merchant verification, "own your number" and account claim all
   dead-end at a code that never arrives — so it gets a rail that can say whether the code
   was actually delivered, instead of a gateway that only says it accepted the request.

   The documented shape (SMS-API Interfaces, NEXAH), and nothing beyond it:
     • send     POST {base}/sendsms      { user, password, senderid, sms, mobiles }
                → { responsecode: 1|0, responsedescription, sms: [ { messageid, smsclientid,
                    mobileno, status, errorcode, errordescription } ] }
     • credit   POST {base}/smscredit    { user, password }
                → { credit, accountexpdate, balanceexpdate }
     • DR       NEXAH POSTs { dlrlist: [ { messageid, mobileno, status, submittime,
                    senttime, deliverytime } ] } to a URL we register with them.
                DELIVRD = the handset got it, UNDELIV = it did not.

   Rules this file holds to:
     • POST ONLY. The spec also documents a GET form that carries `password=` in the query
       string; a credential in a URL ends up in proxy logs, access logs and referrers, so
       that form is not implemented here at any call site.
     • The credentials are never logged, and neither is the message body — an OTP body
       contains the code.
     • `responsecode: 1` means NEXAH accepted the request. It is NOT delivery. Only a DR
       saying DELIVRD is delivery, and a caller that has no DR yet must not claim one.
     • Nothing undocumented is inferred: an unrecognised per-recipient status is treated as
       neither delivered nor failed, and the documented error codes are mapped by number.

   OPERATOR-OWNED before this can send anything: a NEXAH account (NEXAH_USER /
   NEXAH_PASSWORD), a sender ID registered and approved with the operators
   (NEXAH_SENDER_ID — an unapproved one is refused), and the delivery-receipt URL
   registered with NEXAH (see NEXAH_DLR_SECRET and /webhooks/sms/nexah/:secret).
   ============================================================ */
import { config, nexahConfigured } from "../config.js";
import { fetchT } from "./http.js";

/* The API PATH is not the same on every NEXAH deployment. The published spec documents
   `https://smsvas.com/bulk/public/index.php/api/v1`; a hosted instance can serve the same
   API at `https://<host>/api/v1` (the /bulk/public/index.php form 404s there). NEXAH_API_URL
   is therefore the whole base including the version segment, and a bare host is completed
   with the shorter form rather than guessed at. */
const base = () => {
  const u = config.nexah.apiUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(u) ? u : `${u}/api/v1`;
};

/** The documented error codes. Anything else is reported by number, never guessed at. */
const ERRORS: Record<string, string> = {
  "-10019": "inactive NEXAH user",
  "-10003": "invalid mobile number",
  "-10026": "client SMS id limit exceeded",
  "-10008": "NEXAH balance not enough",
};
export function describeError(code: string | number | undefined | null): string | undefined {
  if (code === undefined || code === null || code === "") return undefined;
  const k = String(code);
  return ERRORS[k] ?? `NEXAH error ${k}`;
}

/** MSISDN as NEXAH wants it: digits only, country code included, no leading +. */
export function msisdn(phone: string, dial = "237"): string {
  const d = String(phone).replace(/\D/g, "");
  if (!d) return "";
  if (d.length > 9) return d;              // already carries a country code
  return `${dial}${d}`;
}

export interface SendResult {
  /** NEXAH accepted the request for this number. Acceptance, NOT delivery. */
  ok: boolean;
  /** NEXAH's id for this message — what a delivery receipt refers back to. */
  messageId?: string;
  detail?: string;
}

/** Send one verification SMS. Never throws: a failure here must leave the caller free to
 *  fall back to another channel, exactly as it would on a gateway timeout. */
export async function sendVerificationSms(to: string, body: string): Promise<SendResult> {
  if (!nexahConfigured()) return { ok: false, detail: "NEXAH is not configured." };
  const mobile = msisdn(to, config.nexah.dial);
  if (!mobile) return { ok: false, detail: "No destination number." };
  try {
    const res = await fetchT(`${base()}/sendsms`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        user: config.nexah.user,
        password: config.nexah.password,
        senderid: config.nexah.senderId,
        sms: body,
        mobiles: mobile,
      }),
    }, 12_000);
    if (!res.ok) return { ok: false, detail: `NEXAH HTTP ${res.status}` };
    const d = (await res.json()) as {
      responsecode?: number; responsedescription?: string; responsemessage?: string;
      /** Some deployments answer a rejection with HTTP 200 and this shape instead. */
      errorcode?: number | string; message?: string;
      sms?: Array<{ messageid?: string; mobileno?: string; status?: string; errorcode?: number | string; errordescription?: string }>;
    };
    // A REJECTION CAN ARRIVE AS HTTP 200. The hosted deployment this is pointed at answers
    // a bad credential with `{"errorcode":401,"message":"Unauthorised"}` and a 200 status —
    // no responsecode at all. Reading only the documented envelope turned that into a bare
    // "refused the request" and threw away the one word that says what is wrong.
    if (d.errorcode !== undefined && Number(d.errorcode) !== 0 && d.responsecode === undefined) {
      return { ok: false, detail: `${d.message || "refused"} (${d.errorcode})` };
    }
    // The documented envelope can also fail on its own (bad credentials, empty balance)
    // with no per-message array — that is what the error table is mostly about.
    if (Number(d.responsecode) !== 1) {
      return { ok: false, detail: d.responsemessage || d.responsedescription || d.message || "NEXAH refused the request" };
    }
    const one = d.sms?.[0];
    if (!one) return { ok: false, detail: "NEXAH accepted the request but reported no message" };
    if (String(one.status ?? "").toLowerCase() !== "success") {
      return { ok: false, detail: describeError(one.errorcode) ?? one.errordescription ?? "NEXAH did not accept this number" };
    }
    return { ok: true, messageId: one.messageid ? String(one.messageid) : undefined };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "NEXAH send failed" };
  }
}

/* ---------- credit ----------
   Running out of SMS credit does not degrade anything gracefully: it silently stops every
   verification code, and every flow gated on one stops with it. Cached, because this is
   read by an operator screen and there is no reason to ask NEXAH on every page load. */
export interface Credit { credit: number; accountExpires?: string; balanceExpires?: string; at: string }
let cached: { v: Credit | null; at: number } | null = null;
const CREDIT_TTL_MS = 5 * 60_000;

export function _resetCreditCache(): void { cached = null; }

export async function credit(force = false): Promise<Credit | null> {
  if (!nexahConfigured()) return null;
  if (!force && cached && Date.now() - cached.at < CREDIT_TTL_MS) return cached.v;
  try {
    const res = await fetchT(`${base()}/smscredit`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ user: config.nexah.user, password: config.nexah.password }),
    }, 10_000);
    if (!res.ok) { cached = { v: null, at: Date.now() }; return null; }
    const d = (await res.json()) as { credit?: number | string; accountexpdate?: string; balanceexpdate?: string; errorcode?: number | string; message?: string };
    // Same 200-with-an-error shape as the send path: a refusal is UNKNOWN credit, not zero.
    if (d.credit === undefined && d.errorcode !== undefined) {
      console.warn(`[nexah] credit refused: ${d.message ?? ""} (${d.errorcode})`);
      cached = { v: null, at: Date.now() };
      return null;
    }
    const n = Number(d.credit);
    // A balance we could not read is UNKNOWN, not zero — the same distinction the payout
    // float makes. Returning 0 here would read as "out of credit" and page someone.
    if (!Number.isFinite(n)) { cached = { v: null, at: Date.now() }; return null; }
    const v: Credit = { credit: n, accountExpires: d.accountexpdate, balanceExpires: d.balanceexpdate, at: new Date().toISOString() };
    cached = { v, at: Date.now() };
    return v;
  } catch {
    cached = { v: null, at: Date.now() };
    return null;
  }
}

/** Below this, an operator should top up before verification starts failing. */
export const lowCreditFloor = (): number => {
  const n = Number(process.env.NEXAH_LOW_CREDIT ?? 200);
  return Number.isFinite(n) && n >= 0 ? n : 200;
};

/* ---------- delivery receipts ----------
   NEXAH posts a batch. Nothing signs it, so the URL carries a secret and the body is
   treated as a hint about messages WE sent: a receipt naming an id we never issued changes
   nothing. */
export interface Dlr { messageId: string; status: "delivered" | "failed"; at?: string; mobile?: string }

/** Parse a dlrlist body into the receipts we recognise. Unknown statuses are dropped rather
 *  than guessed — "not DELIVRD" is not the same as "UNDELIV". */
export function parseDlr(raw: string): Dlr[] {
  let d: { dlrlist?: Array<Record<string, unknown>> };
  try { d = JSON.parse(raw) as typeof d; } catch { return []; }
  const list = Array.isArray(d.dlrlist) ? d.dlrlist : [];
  const out: Dlr[] = [];
  for (const r of list) {
    const id = r.messageid;
    if (typeof id !== "string" || !id) continue;
    const s = String(r.status ?? "").toUpperCase();
    // The spec documents DELIVRD / UNDELIV; the worked example in §2.3.2 echoes 1 / 0 back.
    const status = s === "DELIVRD" || s === "1" ? "delivered" : s === "UNDELIV" || s === "0" ? "failed" : null;
    if (!status) continue;
    out.push({
      messageId: id,
      status,
      at: typeof r.deliverytime === "string" ? r.deliverytime : typeof r.senttime === "string" ? r.senttime : undefined,
      mobile: typeof r.mobileno === "string" ? r.mobileno : undefined,
    });
  }
  return out;
}

/** Is the secret in the callback path ours? Timing-safe by length-then-compare; the secret
 *  is the only thing standing between this endpoint and anyone who finds the URL. */
export function verifyDlrSecret(given: string | undefined): boolean {
  const want = (config.nexah.dlrSecret ?? "").trim();
  if (!want || !given || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
