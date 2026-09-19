import type { IdentityErrorCode, IdentityStatus } from "../../../../shared/identity.js";

/** A typed error the resolver and routes map to a status and an HTTP answer. Messages are
 *  for the person; provider internals stay in `detail` (logs only). */
export class IdentityError extends Error {
  constructor(public code: IdentityErrorCode, message: string, public detail?: string, public retryable = false) { super(message); }
}

export const STATUS_FOR_ERROR: Partial<Record<IdentityErrorCode, IdentityStatus>> = {
  IDENTITY_NOT_FOUND: "NOT_FOUND", IDENTITY_INACTIVE: "INACTIVE", IDENTITY_UNSUPPORTED_COUNTRY: "UNSUPPORTED", IDENTITY_UNSUPPORTED_OPERATOR: "UNSUPPORTED",
  IDENTITY_PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE", IDENTITY_PROVIDER_TIMEOUT: "PROVIDER_UNAVAILABLE", IDENTITY_PROVIDER_AUTH_ERROR: "PROVIDER_UNAVAILABLE",
  IDENTITY_VERIFICATION_FAILED: "VERIFICATION_FAILED",
};
export const HTTP_FOR_ERROR: Record<IdentityErrorCode, number> = {
  IDENTITY_INVALID_IDENTIFIER: 400, IDENTITY_UNSUPPORTED_COUNTRY: 422, IDENTITY_UNSUPPORTED_OPERATOR: 422, IDENTITY_NOT_FOUND: 200, IDENTITY_INACTIVE: 200,
  IDENTITY_PROVIDER_UNAVAILABLE: 200, IDENTITY_PROVIDER_TIMEOUT: 200, IDENTITY_PROVIDER_AUTH_ERROR: 200, IDENTITY_VERIFICATION_FAILED: 200,
  IDENTITY_RATE_LIMITED: 429, IDENTITY_UNAUTHORIZED: 401, IDENTITY_DISABLED: 404,
};
