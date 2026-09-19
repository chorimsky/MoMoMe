/* ============================================================
   MTN MoMo Open API — the operator's own record (docs/identity/IDENTITY_PROVIDER_CONFIGURATION.md).

   Endpoints (Collections product):
     POST {base}/collection/token/                                        → bearer (Basic apiUser:apiKey)
     GET  {base}/collection/v1_0/accountholder/msisdn/{msisdn}/active     → { result: true|false }
     GET  {base}/collection/v1_0/accountholder/msisdn/{msisdn}/basicuserinfo → { given_name, family_name, … }
   Headers: Ocp-Apim-Subscription-Key, X-Target-Environment (sandbox | mtncameroon …).

   Configured only when MTN_MOMO_SUBSCRIPTION_KEY + MTN_MOMO_API_USER + MTN_MOMO_API_KEY
   are set. Sandbox and production are separate credential sets by definition (different
   base URL and target environment). Never called on the payment path.
   ============================================================ */
import { fetchT } from "../../../adapters/http.js";
import type { IdentityProvider, IdentityContext, ProviderAnswer } from "./types.js";
import type { NormalizedIdentifier, IdentityProviderHealth } from "../../../../../shared/identity.js";
import { IdentityError } from "../errors.js";

const env = (k: string, d = "") => (process.env[k] ?? d).trim();
const cfg = () => ({
  base: env("MTN_MOMO_API_URL", env("MTN_MOMO_TARGET_ENV", "sandbox") === "sandbox" ? "https://sandbox.momodeveloper.mtn.com" : "https://proxy.momoapi.mtn.com"),
  target: env("MTN_MOMO_TARGET_ENV", "sandbox"),
  subKey: env("MTN_MOMO_SUBSCRIPTION_KEY"), user: env("MTN_MOMO_API_USER"), key: env("MTN_MOMO_API_KEY"),
  countries: env("MTN_MOMO_COUNTRIES", "CM").split(",").map((s) => s.trim()).filter(Boolean),
});

let token: { value: string; expiresAt: number } | null = null;
async function bearer(timeoutMs: number): Promise<string> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  const c = cfg();
  const res = await fetchT(`${c.base}/collection/token/`, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": c.subKey, authorization: `Basic ${Buffer.from(`${c.user}:${c.key}`).toString("base64")}` } }, timeoutMs);
  if (res.status === 401 || res.status === 403) throw new IdentityError("IDENTITY_PROVIDER_AUTH_ERROR", "Recipient verification is temporarily unavailable.", `mtn token ${res.status}`);
  if (!res.ok) throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `mtn token ${res.status}`, true);
  const d = (await res.json()) as { access_token: string; expires_in?: number };
  token = { value: d.access_token, expiresAt: Date.now() + (d.expires_in ?? 3600) * 1000 };
  return d.access_token;
}

const stats = { calls: 0, ok: 0, latency: [] as number[], lastError: "" };
const note = (ok: boolean, ms: number, err?: string) => { stats.calls++; if (ok) stats.ok++; stats.latency.push(ms); if (stats.latency.length > 200) stats.latency.shift(); if (err) stats.lastError = err; };

export const mtnDirect: IdentityProvider = {
  name: "mtn_direct",
  authoritative: true,
  configured: () => { const c = cfg(); return !!(c.subKey && c.user && c.key); },
  supports: (country, operator) => operator === "MTN" && cfg().countries.includes(country),
  async resolve(id: NormalizedIdentifier, ctx: IdentityContext): Promise<ProviderAnswer> {
    const c = cfg(); const t0 = Date.now();
    const msisdn = id.identifier.replace(/^\+/, "");
    const H = async () => ({ "Ocp-Apim-Subscription-Key": c.subKey, "X-Target-Environment": c.target, authorization: `Bearer ${await bearer(ctx.timeoutMs)}` });
    try {
      const active = await fetchT(`${c.base}/collection/v1_0/accountholder/msisdn/${msisdn}/active`, { headers: await H() }, ctx.timeoutMs);
      if (active.status === 401 || active.status === 403) { token = null; throw new IdentityError("IDENTITY_PROVIDER_AUTH_ERROR", "Recipient verification is temporarily unavailable.", `mtn active ${active.status}`); }
      if (active.status === 404) { note(true, Date.now() - t0); return { status: "NOT_FOUND", verified: false, accountStatus: "UNKNOWN", capabilities: caps(false), provider: { name: "MTN" }, error: "IDENTITY_NOT_FOUND" }; }
      if (!active.ok) throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `mtn active ${active.status}`, true);
      const a = (await active.json().catch(() => ({}))) as { result?: boolean };
      if (a.result === false) { note(true, Date.now() - t0); return { status: "INACTIVE", verified: false, accountStatus: "INACTIVE", capabilities: caps(false), provider: { name: "MTN", verifiedAt: new Date().toISOString() }, error: "IDENTITY_INACTIVE" }; }
      const info = await fetchT(`${c.base}/collection/v1_0/accountholder/msisdn/${msisdn}/basicuserinfo`, { headers: await H() }, ctx.timeoutMs);
      let name: string | undefined;
      if (info.ok) { const d = (await info.json().catch(() => ({}))) as { given_name?: string; family_name?: string; name?: string }; name = [d.given_name, d.family_name].filter(Boolean).join(" ").trim() || d.name?.trim() || undefined; }
      else if (info.status !== 404) throw new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", `mtn basicuserinfo ${info.status}`, true);
      note(true, Date.now() - t0);
      // Active, and the operator gave the holder's name → VERIFIED. Active without a name
      // (the product may not expose it in every market) is still a verified ACCOUNT.
      return { status: "VERIFIED", verified: true, displayName: name, accountStatus: "ACTIVE", capabilities: caps(true), provider: { name: "MTN", verifiedAt: new Date().toISOString() } };
    } catch (e) {
      const err = e instanceof IdentityError ? e : new IdentityError(/abort|timeout/i.test(String((e as Error)?.message)) ? "IDENTITY_PROVIDER_TIMEOUT" : "IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", (e as Error)?.message, true);
      note(false, Date.now() - t0, err.detail);
      throw err;
    }
  },
  async health(): Promise<IdentityProviderHealth> {
    const c = cfg(); const configured = this.configured();
    const rate = stats.calls ? stats.ok / stats.calls : null;
    const lat = stats.latency.length ? Math.round(stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length) : null;
    return { name: this.name, configured, status: !configured ? "NOT_CONFIGURED" : c.target === "sandbox" ? "SANDBOX" : rate == null ? "OPERATIONAL" : rate < 0.5 ? "DOWN" : rate < 0.9 ? "DEGRADED" : "OPERATIONAL", supports: { operators: ["MTN"], countries: c.countries, resolve: true, verify: true }, latencyMs: lat, successRate: rate, lastError: stats.lastError || undefined };
  },
};
const caps = (ok: boolean) => ({ mobile_money: true, receive: ok, send: ok, payout: ok, collection: ok });
