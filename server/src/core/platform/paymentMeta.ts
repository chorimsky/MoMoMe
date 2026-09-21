/* ============================================================
   API v1 — what the public API knows about a payment that the engine's Payment record
   does not carry: which organization/application/credential created it, the customer's
   own `reference` and `metadata`, the request id, the compliance decision and the
   liquidity reservation. Additive: the engine's Payment type is untouched.
   ============================================================ */
import { register, touch } from "../persist.js";

export interface PaymentMeta {
  paymentId: string; orgId: string; appId: string; credentialId: string; env: "live" | "test";
  reference?: string; metadata?: Record<string, string>; requestId: string; createdAt: string;
  compliance?: { status: "CLEAR" | "REVIEW" | "BLOCKED"; reasons: string[]; at: string };
  reservationId?: string;
  /** Public state last announced to webhooks, to emit each transition exactly once. */
  lastPublicState?: string;
}
const metas = new Map<string, PaymentMeta>();
const byRef = new Map<string, string>(); // `${orgId}|${env}|${reference}` -> paymentId
register("platform_payment_meta", () => [...metas.values()], (d: PaymentMeta[]) => { for (const m of d) { metas.set(m.paymentId, m); if (m.reference) byRef.set(`${m.orgId}|${m.env}|${m.reference}`, m.paymentId); } });

export function putMeta(m: PaymentMeta): void { metas.set(m.paymentId, m); if (m.reference) byRef.set(`${m.orgId}|${m.env}|${m.reference}`, m.paymentId); touch("platform_payment_meta"); }
export function metaOf(paymentId: string): PaymentMeta | undefined { return metas.get(paymentId); }
export function updateMeta(paymentId: string, patch: Partial<PaymentMeta>): void { const m = metas.get(paymentId); if (!m) return; Object.assign(m, patch); touch("platform_payment_meta"); }
export function metasOf(orgId: string, env: string): PaymentMeta[] { return [...metas.values()].filter((m) => m.orgId === orgId && m.env === env); }
export function paymentByReference(orgId: string, env: string, reference: string): string | undefined { return byRef.get(`${orgId}|${env}|${reference}`); }
export function _resetPaymentMeta(): void { metas.clear(); byRef.clear(); }
