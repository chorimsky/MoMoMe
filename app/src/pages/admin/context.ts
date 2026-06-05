/* ============================================================
   Admin shared state — global search, programmatic navigation, and
   the live notifications feed (so the sidebar badge stays in sync).
   ============================================================ */
import { createContext, useContext } from "react";
import type { Tone } from "./AdminUI.js";

export type AdminKey =
  | "overview" | "payments" | "delivery" | "liquidity" | "pricing" | "mobilemoney"
  | "rails" | "merchants" | "customers" | "identities" | "compliance" | "peex" | "reports"
  | "notifications" | "health" | "settings" | "administration";

export interface Notif {
  id: string;
  t: string;
  s: string;
  tone: Tone;
  time: string;
}

export interface AdminCtx {
  query: string;
  setQuery: (q: string) => void;
  /** Programmatic navigation; optional query pre-fills the global search. */
  goTo: (key: AdminKey, query?: string) => void;
  notifications: Notif[];
  dismiss: (id: string) => void;
}

export const AdminContext = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminContext");
  return ctx;
}
