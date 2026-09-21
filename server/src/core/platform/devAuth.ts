/* ============================================================
   Developer dashboard sessions — HMAC tokens like the admin console's, with their OWN
   secret so a developer token can never pass as an operator token (and vice versa).
   Token: `dv.<base64url payload>.<hmac>`, payload { uid, exp }. 12-hour sessions.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { sessionVersion } from "./accounts.js";

const TTL_MS = 12 * 3_600_000;
let persisted: string | null = null;
register("platform_dev_secret", () => persisted, (d: unknown) => { if (typeof d === "string" && d) persisted = d; });
function secret(): string { if (process.env.DEV_SESSION_SECRET) return process.env.DEV_SESSION_SECRET; if (!persisted) { persisted = crypto.randomBytes(32).toString("hex"); touch("platform_dev_secret"); } return persisted; }
const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueDevToken(uid: string): { token: string; expiresAt: string } {
  const exp = Date.now() + TTL_MS;
  // `v` is the user's session version: "log out everywhere" / a password change bumps it and
  // every earlier token stops verifying.
  const payload = Buffer.from(JSON.stringify({ uid, exp, v: sessionVersion(uid) })).toString("base64url");
  return { token: `dv.${payload}.${sign(payload)}`, expiresAt: new Date(exp).toISOString() };
}
export function verifyDevToken(token: unknown): { uid: string } | null {
  if (typeof token !== "string" || !token.startsWith("dv.")) return null;
  const [, payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const d = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid?: string; exp?: number; v?: number }; return d.uid && typeof d.exp === "number" && d.exp > Date.now() && (d.v ?? 1) === sessionVersion(d.uid) ? { uid: d.uid } : null; } catch { return null; }
}
