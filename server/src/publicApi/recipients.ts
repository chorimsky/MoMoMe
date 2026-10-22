/* ============================================================
   POST /v1/recipients/validate — is this a payable Mobile Money number, on which operator,
   and (when a provider answers) whose. Never a guess: `name_status` says whether the name
   came from the operator's records, from MoMo›Me's own verified accounts, or is unknown.

   `active` used to be `name ? true : null` — an INFERENCE. A name coming back does not mean
   anybody checked whether the wallet is open: CamPay's holder_info returns a name and no
   status at all, while MTN's own API checks /active explicitly and Wallet2Cash returns
   isActive alongside the name. So this endpoint was telling a caller "active: true" on the
   strength of having a name, for providers that never said so. A caller deciding whether to
   pay reads that as a fact we established. The resolver already KNOWS the difference —
   accountStatus is ACTIVE, INACTIVE or UNKNOWN — and it was being discarded on the way out.

   Now reported from the real answer, with its provenance: which provider answered, whether
   it was live or cached, and when. Those three are what make the result auditable by
   someone who has to justify a payment later — and they cost nothing, because the resolver
   computes all of them already.
   ============================================================ */
import { route, type Ctx } from "./index.js";
import { err } from "./errors.js";
import { COUNTRIES, checkPhone, splitDialed, compareNames } from "../../../shared/domain.js";
import type { CountryCode } from "../../../shared/types.js";
import { resolveRecipient } from "../core/nameResolver.js";
import { resolveIdentity, identityEnabled } from "../core/identityResolution/resolver.js";
import { rateLimitDurable } from "../core/ratelimit.js";

const PHONE_REASON: Record<string, string> = { empty: "No number given.", foreign_country: "The number belongs to another country.", bad_length: "The number has the wrong number of digits for this country.", unknown_operator: "The number's prefix is not a Mobile Money operator we serve." };
const phoneMessage = (reason: string | undefined) => (reason && PHONE_REASON[reason]) || "Not a valid Mobile Money number for this country.";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

route("post", "/recipients/validate", { scope: "recipients:validate", cls: "recipients" }, async (ctx: Ctx) => {
  const phoneRaw = str(ctx.body.phone);
  if (!phoneRaw) throw err(422, "validation_failed", "`phone` is required (E.164).", { field: "phone" });
  const fallback = (str(ctx.body.country).toUpperCase() || "CM") as CountryCode;
  if (!COUNTRIES[fallback]) throw err(422, "country_unsupported", `Unsupported country ${fallback}.`, { field: "country" });
  const sp = splitDialed(phoneRaw, fallback);
  const chk = checkPhone(sp.local, sp.country);
  const base = { phone: `${COUNTRIES[sp.country].dial}${chk.local}`, country: sp.country, currency: COUNTRIES[sp.country].ccy };
  if (!chk.ok || !chk.provider) return { ...base, valid: false, reason: chk.reason, message: phoneMessage(chk.reason), operator: null, name: null, name_status: "not_checked" };
  // Name lookups go to an operator API: bounded per organization beyond the plan limit so
  // a credential cannot be used to enumerate the subscriber base.
  const rl = await rateLimitDurable(`v1:validate:${ctx.orgId}`, 300, 3_600_000);
  if (!rl.ok) throw err(429, "rate_limited", "Too many recipient validations this hour.", { retry_after_seconds: rl.retryAfterSec });
  const expected = str(ctx.body.name);
  // The identity chain carries the account's real status and the provenance of the answer.
  // Ask it directly when it is on; fall back to the name-only path when it is not, and in
  // that case say plainly that nothing checked the account's status.
  const full = identityEnabled()
    ? await resolveIdentity({ identifier: chk.local, defaultCountry: sp.country, purpose: "RECIPIENT_VERIFICATION", actor: `v1:recipients/validate:${ctx.orgId}`, expectedName: expected || undefined }).catch(() => null)
    : null;
  const r = await resolveRecipient(chk.local, sp.country);
  const name = full?.displayName ?? r.name ?? null;
  const match = expected && name ? compareNames(expected, name) : null;
  // ACTIVE and INACTIVE are statements a provider made. UNKNOWN — or no chain at all — is
  // the absence of one, and must not be dressed up as either.
  const active = full?.accountStatus === "ACTIVE" ? true : full?.accountStatus === "INACTIVE" ? false : null;
  return {
    ...base, valid: true, operator: full?.operator ?? chk.provider,
    name, name_status: name ? ((full?.source === "provider" || r.status === "provider") ? "verified_by_operator" : "verified_by_momome") : "unknown",
    ...(expected ? { name_match: match === "MATCH" ? "match" : match === "NO_MATCH" ? "mismatch" : "not_available" } : {}),
    /** true / false only when a provider SAID so; null means nobody established it. */
    active,
    account_status: full?.accountStatus ?? "UNKNOWN",
    /** Where this answer came from, so a caller can audit it later. `live` is a call made
     *  now; `cache` is a previous verification still inside its window. */
    source: full ? { provider: full.provider?.name ?? null, freshness: full.source === "cache" ? "cache" : full.source === "provider" ? "live" : full.source, checked_at: full.provider?.verifiedAt ?? null, expires_at: full.expiresAt ?? null } : { provider: null, freshness: "not_checked", checked_at: null, expires_at: null },
    request_id: full?.requestId ?? null,
  };
});
