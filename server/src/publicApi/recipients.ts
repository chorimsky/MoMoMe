/* ============================================================
   POST /v1/recipients/validate — is this a payable Mobile Money number, on which operator,
   and (when a provider answers) whose. Never a guess: `name_status` says whether the name
   came from the operator's records, from MoMo›Me's own verified accounts, or is unknown.
   ============================================================ */
import { route, type Ctx } from "./index.js";
import { err } from "./errors.js";
import { COUNTRIES, checkPhone, splitDialed, compareNames } from "../../../shared/domain.js";
import type { CountryCode } from "../../../shared/types.js";
import { resolveRecipient } from "../core/nameResolver.js";
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
  const r = await resolveRecipient(chk.local, sp.country);
  const expected = str(ctx.body.name);
  const name = r.name ?? null;
  const match = expected && name ? compareNames(expected, name) : null;
  return {
    ...base, valid: true, operator: chk.provider,
    name, name_status: name ? (r.status === "provider" ? "verified_by_operator" : "verified_by_momome") : "unknown",
    ...(expected ? { name_match: match === "MATCH" ? "match" : match === "NO_MATCH" ? "mismatch" : "not_available" } : {}),
    active: name ? true : null,
  };
});
