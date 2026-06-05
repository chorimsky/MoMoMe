/* ============================================================
   Admin roles + role-based access — shared by the server (enforcement)
   and the console (nav filtering) so they never disagree.
   ============================================================ */

export type AdminRole =
  | "Super Admin"
  | "Operations Manager"
  | "Finance Manager"
  | "Compliance Officer"
  | "Support Agent"
  | "Read Only";

export const ADMIN_ROLES: AdminRole[] = [
  "Super Admin", "Operations Manager", "Finance Manager", "Compliance Officer", "Support Agent", "Read Only",
];

/** Console sections (≈ nav items / endpoint groups). */
export type Section =
  | "overview" | "payments" | "delivery" | "liquidity" | "pricing" | "mobilemoney"
  | "rails" | "merchants" | "customers" | "identities" | "compliance" | "peex"
  | "reports" | "notifications" | "health" | "settings" | "administration";

/** What each role may access. "all" = every section. */
export const ROLE_SECTIONS: Record<AdminRole, Section[] | "all"> = {
  "Super Admin": "all",
  "Read Only": "all", // sees everything — but never mutates (enforced separately)
  "Operations Manager": ["overview", "payments", "delivery", "liquidity", "mobilemoney", "rails", "merchants", "health", "peex", "notifications"],
  "Finance Manager": ["overview", "pricing", "liquidity", "reports", "settings", "health"],
  "Compliance Officer": ["overview", "compliance", "customers", "identities", "merchants", "health", "peex", "notifications"],
  "Support Agent": ["overview", "customers", "payments", "delivery", "merchants"],
};

/** Short human label of a role's access (shown in the console). */
export const ROLE_ACCESS_LABEL: Record<AdminRole, string> = {
  "Super Admin": "Everything",
  "Operations Manager": "Payments · Delivery · Liquidity · Rails",
  "Finance Manager": "Rates · Liquidity · Reports · Settings",
  "Compliance Officer": "Compliance · Customers · Identities",
  "Support Agent": "Customers · Payments · Delivery",
  "Read Only": "View-only everywhere",
};

export function canAccess(role: AdminRole, section: Section): boolean {
  const a = ROLE_SECTIONS[role];
  return a === "all" || a.includes(section);
}
export const isReadOnly = (role: AdminRole): boolean => role === "Read Only";
export const isSuperAdmin = (role: AdminRole): boolean => role === "Super Admin";

/** Public view of an admin user (never includes the password hash). */
export interface AdminUserView {
  id: string;
  username: string;
  role: AdminRole;
  createdAt: string;
  lastLogin?: string;
}
