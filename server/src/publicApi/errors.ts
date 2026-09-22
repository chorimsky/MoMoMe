/* ============================================================
   API v1 — the error vocabulary. Stable strings: a client branches on `code`, a human
   reads `message`, and `details` carries what is safe to say (never provider payloads).
   ============================================================ */
export type ErrorCode =
  | "unauthorized" | "credential_revoked" | "organization_suspended" | "ip_not_allowed" | "environment_mismatch" | "forbidden_scope"
  | "rate_limited" | "validation_failed" | "idempotency_key_required" | "idempotency_key_invalid" | "idempotency_key_reused" | "idempotency_in_progress"
  | "quote_not_found" | "quote_expired" | "quote_already_used" | "asset_unsupported" | "network_unsupported" | "amount_out_of_range" | "country_unsupported" | "currency_unsupported"
  | "payment_not_found" | "payment_not_cancellable" | "payment_not_refundable" | "recipient_invalid" | "recipient_unverified" | "recipient_reserved"
  | "limit_exceeded" | "compliance_blocked" | "compliance_review" | "insufficient_liquidity" | "provider_unavailable" | "service_paused"
  | "webhook_not_found" | "webhook_url_invalid" | "webhook_limit"
  | "settlement_not_found" | "settlement_invalid" | "insufficient_balance"
  | "not_found" | "internal_error"
  // MoMo›Me Connect (docs/connect §41) — the same vocabulary, lower-cased for consistency.
  | "invalid_request" | "invalid_identity" | "identity_not_found" | "payment_method_unavailable" | "route_unavailable" | "payment_expired" | "payment_failed" | "settlement_failed" | "compliance_rejected" | "duplicate_request" | "provider_error" | "temporary_unavailable";

export class ApiV1Error extends Error {
  constructor(public status: number, public code: ErrorCode, message: string, public details: Record<string, unknown> = {}) { super(message); }
}
export const err = (status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) => new ApiV1Error(status, code, message, details);

/** Map a V1 core reply ({error, message}) onto the v1 vocabulary. The core's error strings
 *  are app-facing; here they become stable API codes. */
export function fromCore(status: number, body: unknown): ApiV1Error {
  const b = (body ?? {}) as { error?: string; message?: string; [k: string]: unknown };
  const m = b.message ?? "Request failed.";
  const map: Record<string, [number, ErrorCode]> = {
    quote_not_found: [404, "quote_not_found"], quote_expired: [410, "quote_expired"], quote_used: [409, "quote_already_used"], quote_already_used: [409, "quote_already_used"],
    bad_amount: [422, "amount_out_of_range"], amount_too_small: [422, "amount_out_of_range"], amount_too_large: [422, "amount_out_of_range"], method_unavailable: [422, "asset_unsupported"], bad_method: [422, "asset_unsupported"],
    bad_country: [422, "country_unsupported"], country_unsupported: [422, "country_unsupported"], bad_recipient: [422, "recipient_invalid"], reserved_number: [422, "recipient_reserved"], recipient_unverified: [409, "recipient_unverified"], confirm_recipient: [409, "recipient_unverified"],
    paused: [503, "service_paused"], service_paused: [503, "service_paused"], rates_stale: [503, "provider_unavailable"], rail_unavailable: [503, "provider_unavailable"], no_rail: [503, "provider_unavailable"], float_low: [503, "insufficient_liquidity"], insufficient_float: [503, "insufficient_liquidity"],
    limit: [422, "limit_exceeded"], limit_exceeded: [422, "limit_exceeded"], over_limit: [422, "limit_exceeded"], blocked: [403, "compliance_blocked"], sanctions: [403, "compliance_blocked"],
    not_found: [404, "not_found"], rate_limited: [429, "rate_limited"],
  };
  const hit = b.error ? map[b.error] : undefined;
  if (hit) return err(hit[0], hit[1], m, {});
  if (status === 400) return err(422, "validation_failed", m, {});
  if (status === 404) return err(404, "not_found", m, {});
  if (status === 409) return err(409, "validation_failed", m, {});
  if (status === 429) return err(429, "rate_limited", m, {});
  if (status >= 500) return err(503, "provider_unavailable", m, {});
  return err(status, "validation_failed", m, {});
}
