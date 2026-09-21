/* ============================================================
   API v1 — test credentials issued by production, honoured by the sandbox.

   The sandbox deployment has its own database. When it meets an `mm_test_` secret it does
   not know, it asks production once — sending the secret's SHA-256, never the secret —
   over an HMAC-signed request (PLATFORM_SYNC_SECRET on both sides), and adopts the
   credential + a shadow of its organization for 10 minutes. Production answers only for
   test-environment credentials, so a live secret can never be learned this way.

   Sandbox env:   PLATFORM_ORIGIN_URL=https://api.momome.xyz  PLATFORM_SYNC_SECRET=…
   Production env: PLATFORM_SYNC_SECRET=…  (same value)
   ============================================================ */
import crypto from "node:crypto";
import { fetchT } from "../../adapters/http.js";
import { credentialByHash, adoptCredential, secretHash, type Credential } from "./credentials.js";
import { getOrganization, setOrganizationFallback, type Organization } from "./orgs.js";
import { register, touch } from "../persist.js";

const SECRET = () => process.env.PLATFORM_SYNC_SECRET ?? "";
const ORIGIN = () => (process.env.PLATFORM_ORIGIN_URL ?? "").replace(/\/$/, "");
export const syncConfigured = () => !!SECRET() && !!ORIGIN();
const sign = (body: string) => crypto.createHmac("sha256", SECRET()).update(body).digest("hex");

/** Production side: verify the sandbox's signature and answer for a TEST credential. */
export function answerVerify(rawBody: string, signature: string | undefined): { status: number; body: unknown } {
  if (!SECRET()) return { status: 404, body: { error: "not_configured" } };
  const expect = sign(rawBody);
  if (!signature || signature.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expect))) return { status: 401, body: { error: "bad_signature" } };
  let hash = "";
  try { hash = String((JSON.parse(rawBody) as { hash?: string }).hash ?? ""); } catch { /* fallthrough */ }
  if (!/^[0-9a-f]{64}$/.test(hash)) return { status: 400, body: { error: "bad_request" } };
  const c = credentialByHash(hash);
  if (!c || c.env !== "test") return { status: 404, body: { error: "unknown" } };
  const org = getOrganization(c.orgId);
  return { status: 200, body: { credential: c, organization: org ? { id: org.id, name: org.name, slug: org.slug, status: org.status, createdAt: org.createdAt, country: org.country, kyb: org.kyb, plan: org.plan, liveEnabled: org.liveEnabled } : null } };
}

/* Sandbox side: shadow organizations adopted from production. */
const shadows = new Map<string, Organization>();
register("platform_shadow_orgs", () => [...shadows.values()], (d: Organization[]) => { for (const o of d) shadows.set(o.id, o); });
export function shadowOrganization(id: string): Organization | undefined { return shadows.get(id); }
setOrganizationFallback(shadowOrganization);
const asked = new Map<string, number>(); // hash -> last ask (negative cache 60 s)

/** Ask production about an unknown test secret; adopt on success. */
export async function verifyWithOrigin(secret: string): Promise<{ credential: Credential; org: Organization } | null> {
  if (!syncConfigured()) return null;
  const hash = secretHash(secret);
  const last = asked.get(hash); if (last && Date.now() - last < 60_000) return null;
  asked.set(hash, Date.now());
  const body = JSON.stringify({ hash });
  try {
    const res = await fetchT(`${ORIGIN()}/v1/internal/credentials/verify`, { method: "POST", headers: { "content-type": "application/json", "x-momome-sync-signature": sign(body) }, body }, 5_000);
    if (!res.ok) return null;
    const j = (await res.json()) as { credential?: Credential; organization?: Organization | null };
    if (!j.credential || !j.organization) return null;
    shadows.set(j.organization.id, j.organization); touch("platform_shadow_orgs");
    adoptCredential(j.credential, hash);
    return { credential: j.credential, org: j.organization };
  } catch { return null; }
}
