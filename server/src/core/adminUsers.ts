/* ============================================================
   Admin user accounts — real per-user credentials (unique username + password),
   roles, scrypt-hashed passwords, persisted. Replaces the single shared
   password (which now lives on only as the seed + master recovery key).
   ============================================================ */
import crypto from "node:crypto";
import type { AdminRole, AdminUserView } from "../../../shared/roles.js";
import { register, touch } from "./persist.js";
import { config } from "../config.js";
import { id } from "./ids.js";

interface AdminUser {
  id: string;
  username: string; // unique, lowercased login id
  role: AdminRole;
  salt: string;
  hash: string;
  createdAt: string;
  lastLogin?: string;
}

const byId = new Map<string, AdminUser>();
register("admin_users", () => [...byId.values()], (list: AdminUser[]) => { for (const u of list) byId.set(u.id, u); });

const norm = (username: string) => username.trim().toLowerCase();
function hashPw(password: string, salt: string): string { return crypto.scryptSync(password, salt, 64).toString("hex"); }
function makeHash(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPw(password, salt) };
}
function pwMatches(u: AdminUser, password: string): boolean {
  const a = Buffer.from(hashPw(password, u.salt));
  const b = Buffer.from(u.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const view = (u: AdminUser): AdminUserView => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin });

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export function passwordIssue(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 200) return "Password is too long.";
  return null;
}

/** Seed the first Super Admin (username "admin", password = ADMIN_PASSWORD) so
 *  the console is reachable out of the box. Idempotent. */
export function seedAdminUsers(): void {
  if (byId.size > 0) return;
  createUser("admin", config.admin.password, "Super Admin");
}

export function findByUsername(username: string): AdminUser | undefined {
  const k = norm(username);
  return [...byId.values()].find((u) => u.username === k);
}
export function getUser(uid: string): AdminUser | undefined { return byId.get(uid); }
export function listUsers(): AdminUserView[] {
  return [...byId.values()].map(view).sort((a, b) => a.username.localeCompare(b.username));
}
export function userCount(): number { return byId.size; }

export function createUser(username: string, password: string, role: AdminRole): AdminUserView {
  const u: AdminUser = { id: id("usr"), username: norm(username), role, ...makeHash(password), createdAt: new Date().toISOString() };
  byId.set(u.id, u);
  touch("admin_users");
  return view(u);
}

/** Validate credentials; returns the user (and stamps lastLogin) or null. */
export function verifyCredentials(username: string, password: string): AdminUser | null {
  const u = findByUsername(username);
  if (!u || !pwMatches(u, password)) return null;
  u.lastLogin = new Date().toISOString();
  touch("admin_users");
  return u;
}

export function setPassword(uid: string, password: string): boolean {
  const u = byId.get(uid);
  if (!u) return false;
  const { salt, hash } = makeHash(password);
  u.salt = salt; u.hash = hash;
  touch("admin_users");
  return true;
}

export function changeOwnPassword(uid: string, current: string, next: string): { ok: boolean; reason?: "not_found" | "bad_current" } {
  const u = byId.get(uid);
  if (!u) return { ok: false, reason: "not_found" };
  if (!pwMatches(u, current)) return { ok: false, reason: "bad_current" };
  setPassword(uid, next);
  return { ok: true };
}

export function setRole(uid: string, role: AdminRole): boolean {
  const u = byId.get(uid);
  if (!u) return false;
  // Never strip the last Super Admin of their role.
  if (u.role === "Super Admin" && role !== "Super Admin" && superAdminCount() <= 1) return false;
  u.role = role;
  touch("admin_users");
  return true;
}

export function deleteUser(uid: string): boolean {
  const u = byId.get(uid);
  if (!u) return false;
  if (u.role === "Super Admin" && superAdminCount() <= 1) return false; // never remove the last Super Admin
  byId.delete(uid);
  touch("admin_users");
  return true;
}

function superAdminCount(): number { return [...byId.values()].filter((u) => u.role === "Super Admin").length; }

/** Master recovery: the ADMIN_PASSWORD env (server-controlled) can reset any
 *  account's password. This is the "forgot password" backstop when there's no
 *  email/SMS — whoever controls the deployment can recover access. */
export function masterRecoveryMatches(key: unknown): boolean {
  const expected = config.admin.recoveryKey;
  if (typeof key !== "string" || !expected) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
