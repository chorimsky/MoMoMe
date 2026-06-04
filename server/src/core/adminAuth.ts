/* ============================================================
   Admin authentication — a shared operator password gates the admin console
   and every /admin/* API. Login exchanges the password for a stateless,
   HMAC-signed session token (no DB / session store needed): the signature is
   derived from a server secret, so a forged or tampered token is rejected.
   Tokens carry an expiry and survive restarts (secret is stable per password).
   ============================================================ */
import crypto from "node:crypto";
import { config } from "../config.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

/** Signing secret: explicit ADMIN_SESSION_SECRET, else derived from the
 *  password — stable across restarts, and rotating the password ends sessions. */
function secret(): string {
  return config.admin.sessionSecret || crypto.createHash("sha256").update(`mm-admin:${config.admin.password}`).digest("hex");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Constant-time password check against the configured operator password. */
export function checkPassword(pw: unknown): boolean {
  if (typeof pw !== "string" || !config.admin.password) return false;
  const a = Buffer.from(pw);
  const b = Buffer.from(config.admin.password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Issue a signed session token valid for SESSION_TTL_MS. */
export function issueToken(): { token: string; expiresAt: string } {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(exp).toISOString() };
}

/** Verify a token's signature and expiry (constant-time on the signature). */
export function verifyToken(token: unknown): boolean {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: number };
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

/** Pull a bearer token from the Authorization header (or x-admin-token). */
export function tokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const auth = headers["authorization"];
  const raw = Array.isArray(auth) ? auth[0] : auth;
  if (raw?.startsWith("Bearer ")) return raw.slice(7).trim();
  const alt = headers["x-admin-token"];
  return Array.isArray(alt) ? alt[0] : alt;
}
