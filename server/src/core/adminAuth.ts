/* ============================================================
   Admin authentication — per-user login (see adminUsers) exchanged for a
   stateless, HMAC-signed session token carrying the user id + role. The
   signature is derived from a server secret, so a forged/tampered token is
   rejected. Tokens carry an expiry and survive restarts.
   ============================================================ */
import crypto from "node:crypto";
import type { AdminRole } from "../../../shared/roles.js";
import { config } from "../config.js";
import { register, touch } from "./persist.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

/** A verified session: which user, what role, and — for step-up auth — until when the
 *  session is ELEVATED. Elevation is proof the operator re-entered their password
 *  moments ago, so a walked-away laptop or a stolen token cannot move money or change
 *  who has access. It is a claim inside the signed token (not server state), so it
 *  survives serverless instances without a session store, and it EXPIRES on its own. */
export interface Session { uid: string; role: AdminRole; elevatedUntil?: number; }

/** How long a step-up lasts. Short on purpose: long enough to complete a task, short
 *  enough that an unattended console is not a standing authorisation. */
export const ELEVATION_TTL_MS = 10 * 60 * 1000;

/** Token-signing secret. Prefer an explicit ADMIN_SESSION_SECRET; otherwise a
 *  random secret generated once and persisted — so token forgery is NOT coupled
 *  to the admin password (which doubles as the recovery key). Stable across
 *  restarts via the store; rotating it ends all sessions. */
let persistedSecret: string | null = null;
register("admin_secret", () => persistedSecret, (d: unknown) => { if (typeof d === "string" && d) persistedSecret = d; });
function secret(): string {
  if (config.admin.sessionSecret) return config.admin.sessionSecret;
  if (!persistedSecret) { persistedSecret = crypto.randomBytes(32).toString("hex"); touch("admin_secret"); }
  return persistedSecret;
}
function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Issue a signed session token for a user, valid for SESSION_TTL_MS. */
export function issueToken(session: Session): { token: string; expiresAt: string } {
  const exp = Date.now() + SESSION_TTL_MS;
  // `elv` is capped at the session expiry — elevation can never outlive the session it
  // belongs to, even if a longer value were somehow passed in.
  const elv = session.elevatedUntil ? Math.min(session.elevatedUntil, exp) : undefined;
  const payload = Buffer.from(JSON.stringify({ uid: session.uid, role: session.role, exp, ...(elv ? { elv } : {}) })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(exp).toISOString() };
}

/** Verify a token's signature + expiry; returns the session or null. */
export function verifyToken(token: unknown): Session | null {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid?: string; role?: AdminRole; exp?: number; elv?: number };
    if (typeof d.exp !== "number" || d.exp <= Date.now() || !d.uid || !d.role) return null;
    // An expired elevation is simply dropped — the session stays valid, it is just no
    // longer elevated, so the operator is asked to re-authenticate rather than logged out.
    const elevatedUntil = typeof d.elv === "number" && d.elv > Date.now() ? d.elv : undefined;
    return { uid: d.uid, role: d.role, ...(elevatedUntil ? { elevatedUntil } : {}) };
  } catch {
    return null;
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

/** Is this session currently elevated (password re-entered within ELEVATION_TTL_MS)? */
export function isElevated(session: Session | null | undefined): boolean {
  return !!session?.elevatedUntil && session.elevatedUntil > Date.now();
}
