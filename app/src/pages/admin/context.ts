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

export const DEFAULT_NOTIFS: Notif[] = [
  { id: "n1", t: "Payment failed", s: "MMM284067 · USDT timeout", tone: "bad", time: "2m ago" },
  { id: "n2", t: "Large transaction alert", s: "1.2M XAF · +237 678…", tone: "warn", time: "11m ago" },
  { id: "n3", t: "Liquidity low", s: "XAF pool below 200M floor", tone: "warn", time: "26m ago" },
  { id: "n4", t: "Provider offline", s: "Airtel · maintenance window", tone: "warn", time: "1h ago" },
  { id: "n5", t: "Compliance alert", s: "1 transaction under review", tone: "bad", time: "2h ago" },
  { id: "n6", t: "API error", s: "FX feed reconnected", tone: "recv", time: "3h ago" },
];

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
