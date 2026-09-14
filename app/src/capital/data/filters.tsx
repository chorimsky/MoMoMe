/* ============================================================
   Global filters — one context, persisted in sessionStorage, read by every
   data-driven page so KPIs, charts, tables and recommendations all move together.
   ============================================================ */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { IntelFilters, Period, Ccy, ScenarioName } from "@shared/capital.js";

export interface GlobalFilters extends Required<Pick<IntelFilters, "period" | "country" | "rail" | "provider" | "scenario">> { ccy: Ccy; capitalType: "ALL" | "OWN" | "POWER" | "SCALE" | "STRATEGIC"; investorType: string }
const DEFAULTS: GlobalFilters = { period: "30d", ccy: "XAF", country: "ALL", rail: "ALL", provider: "ALL", scenario: "BASE", capitalType: "ALL", investorType: "ALL" };
const KEY = "mm_capital_filters";

interface Ctx { filters: GlobalFilters; set: (patch: Partial<GlobalFilters>) => void; reset: () => void; intel: IntelFilters }
const FiltersCtx = createContext<Ctx | null>(null);

function load(): GlobalFilters {
  try { const v = sessionStorage.getItem(KEY); if (v) return { ...DEFAULTS, ...(JSON.parse(v) as Partial<GlobalFilters>) }; } catch { /* blocked */ }
  return DEFAULTS;
}
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilters>(load);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(filters)); } catch { /* blocked */ } }, [filters]);
  const value = useMemo<Ctx>(() => ({
    filters,
    set: (patch) => setFilters((f) => ({ ...f, ...patch })),
    reset: () => setFilters(DEFAULTS),
    intel: { period: filters.period as Period, country: filters.country, rail: filters.rail, provider: filters.provider, scenario: filters.scenario as ScenarioName },
  }), [filters]);
  return <FiltersCtx.Provider value={value}>{children}</FiltersCtx.Provider>;
}
export function useFilters(): Ctx {
  const c = useContext(FiltersCtx);
  if (!c) throw new Error("useFilters must be used inside FiltersProvider");
  return c;
}
