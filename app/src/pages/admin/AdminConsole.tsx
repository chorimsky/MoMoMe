/* ============================================================
   MoMo›Me Admin — console shell (sidebar · topbar · drawer · router)
   Ported from project/admin.jsx. The design-tool "tweaks panel" and
   postMessage editor are intentionally dropped (not part of product).
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../../components/atoms.js";
import { api } from "../../api/client.js";
import { AdminContext, type AdminKey, type Notif } from "./context.js";
import { OverviewView } from "./views/Overview.js";
import { PaymentsView } from "./views/Payments.js";
import { IdentitiesView } from "./views/Identities.js";
import { MerchantsView } from "./views/Merchants.js";
import { CustomersView } from "./views/Customers.js";
import { DeliveryView } from "./views/Delivery.js";
import { LiquidityView } from "./views/Liquidity.js";
import { PricingView } from "./views/Pricing.js";
import { MobileMoneyView } from "./views/MobileMoney.js";
import { RailsView } from "./views/Rails.js";
import { ComplianceView } from "./views/Compliance.js";
import { ReportsView } from "./views/Reports.js";
import { HealthView } from "./views/Health.js";
import { AdministrationView } from "./views/Administration.js";
import { PeexView } from "./views/Peex.js";
import { NotificationsView } from "./views/Notifications.js";
import { SettingsView } from "./views/Settings.js";
import "./admin.css";

/* ---------- icons ---------- */
function Icon({ name, s = 17 }: { name: string; s?: number }) {
  const p = { width: s, height: s, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const I: Record<string, ReactNode> = {
    overview: <g><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></g>,
    payments: <g><path d="M2 5h10l-2-2M14 11H4l2 2" /></g>,
    rails: <g><path d="M9 2L3.5 9H8l-1 5 5.5-7H8z" /></g>,
    identities: <g><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 1.5" /></g>,
    merchants: <g><circle cx="4.5" cy="4.5" r="2" /><circle cx="11.5" cy="11.5" r="2" /><circle cx="11.5" cy="4.5" r="1.3" /><path d="M6 5.5l4 .5M6 6l4.5 4.5" /></g>,
    customers: <g><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" /></g>,
    liquidity: <g><path d="M8 1.5C8 1.5 3.5 6 3.5 9.5a4.5 4.5 0 009 0C12.5 6 8 1.5 8 1.5z" /></g>,
    pricing: <g><path d="M2.5 8h11M5 4.5h6M5 11.5h6" /><circle cx="8" cy="8" r="6.2" /></g>,
    compliance: <g><path d="M8 1.5l5 2v3.5c0 3-2.2 5.5-5 6.5-2.8-1-5-3.5-5-6.5V3.5z" /><path d="M6 8l1.5 1.5L10.5 6" /></g>,
    peex: <g><circle cx="4" cy="8" r="2" /><circle cx="12" cy="4" r="2" /><circle cx="12" cy="12" r="2" /><path d="M5.7 7l4.6-2.5M5.7 9l4.6 2.5" /></g>,
    delivery: <g><path d="M1.5 4.5h8v6h-8z" /><path d="M9.5 6.5h3l2 2v2h-5z" /><circle cx="4" cy="11.5" r="1.3" /><circle cx="11.5" cy="11.5" r="1.3" /></g>,
    mobilemoney: <g><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7 12.5h2" /></g>,
    reports: <g><path d="M2.5 13.5V8M6 13.5V3.5M9.5 13.5V6M13 13.5V2.5" /></g>,
    health: <g><path d="M1.5 8h3l1.5-4 3 8 1.5-4h3" /></g>,
    administration: <g><circle cx="8" cy="4.5" r="2.2" /><path d="M3.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" /><circle cx="12.5" cy="3.5" r="1" /></g>,
    notifications: <g><path d="M8 2a4 4 0 00-4 4c0 4-1.5 5-1.5 5h11S12 10 12 6a4 4 0 00-4-4z" /><path d="M6.8 14a1.4 1.4 0 002.4 0" /></g>,
    settings: <g><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" /></g>,
  };
  return <svg {...p}>{I[name] ?? I.overview}</svg>;
}

/* ---------- nav model ---------- */
type Key =
  | "overview" | "payments" | "delivery" | "liquidity" | "pricing" | "mobilemoney"
  | "rails" | "merchants" | "customers" | "identities" | "compliance" | "peex" | "reports"
  | "notifications" | "health" | "settings" | "administration";

const NAV: Array<{ group: string | null; items: Array<[Key, string]> }> = [
  { group: null, items: [["overview", "Overview"]] },
  { group: "Payments", items: [["payments", "Payments"], ["delivery", "Delivery"]] },
  { group: "Treasury", items: [["liquidity", "Liquidity"], ["pricing", "Rates & Pricing"]] },
  { group: "Rails", items: [["mobilemoney", "Mobile Money"], ["rails", "Payment Rails"]] },
  { group: "Network", items: [["merchants", "Merchant Graph"], ["identities", "Identities"], ["customers", "Customers"]] },
  { group: "Risk", items: [["compliance", "Compliance"], ["peex", "Peex"]] },
  { group: "Insights", items: [["reports", "Reports"], ["notifications", "Notifications"]] },
  { group: "System", items: [["health", "System Health"], ["settings", "Settings"], ["administration", "Administration"]] },
];
const TITLES = Object.fromEntries(NAV.flatMap((g) => g.items)) as Record<Key, string>;
const VIEWS: Record<Key, ComponentType> = {
  overview: OverviewView,
  payments: PaymentsView,
  delivery: DeliveryView,
  liquidity: LiquidityView,
  pricing: PricingView,
  mobilemoney: MobileMoneyView,
  rails: RailsView,
  merchants: MerchantsView,
  customers: CustomersView,
  identities: IdentitiesView,
  compliance: ComplianceView,
  peex: PeexView,
  reports: ReportsView,
  notifications: NotificationsView,
  health: HealthView,
  settings: SettingsView,
  administration: AdministrationView,
};

const ROLES = ["Super Admin", "Operations Manager", "Finance Manager", "Compliance Officer", "Support Agent", "Read Only"];
const ROLE_ACCESS: Record<string, Key[] | "all"> = {
  "Super Admin": "all",
  "Read Only": "all",
  "Operations Manager": ["overview", "payments", "delivery", "liquidity", "mobilemoney", "rails", "merchants", "health", "peex", "notifications"],
  "Finance Manager": ["overview", "pricing", "liquidity", "reports", "settings"],
  "Compliance Officer": ["overview", "compliance", "merchants", "customers", "identities", "health", "peex", "notifications"],
  "Support Agent": ["overview", "merchants", "customers", "payments", "delivery"],
};
const canAccess = (role: string, key: Key) => {
  const a = ROLE_ACCESS[role];
  return a === "all" || a.includes(key);
};

function loadSection(): Key {
  try {
    const v = localStorage.getItem("mm_admin_section") as Key | null;
    if (v && v in VIEWS) return v;
  } catch {
    /* storage blocked */
  }
  return "overview";
}

const SEARCHABLE: Key[] = ["payments", "customers"];

export function AdminConsole() {
  const [active, setActive] = useState<Key>(loadSection);
  const [role, setRole] = useState("Super Admin");
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [notifications, setNotifications] = useState<Notif[]>([]);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  // Real operational notifications derived from live payment activity.
  useEffect(() => {
    let alive = true;
    // Real notifications only — on error fall back to empty (never fabricate).
    api.adminNotifications()
      .then((n) => { if (alive) setNotifications(n as Notif[]); })
      .catch(() => { if (alive) setNotifications([]); });
    api.getConfig().then((c) => { if (alive) setBrandLogo(c.brandLogo); }).catch(() => {});
    const onLogo = (e: Event) => setBrandLogo((e as CustomEvent).detail ?? null);
    window.addEventListener("mm-brand-logo", onLogo);
    return () => { alive = false; window.removeEventListener("mm-brand-logo", onLogo); };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("mm_admin_section", active);
    } catch {
      /* storage blocked */
    }
  }, [active]);

  useEffect(() => {
    if (!canAccess(role, active)) setActive("overview");
  }, [role, active]);

  const admin = useMemo(
    () => ({
      query,
      setQuery: (q: string) => {
        setQueryState(q);
        // Typing a search jumps to a searchable view so results are visible.
        if (q && !SEARCHABLE.includes(active) && canAccess(role, "payments")) setActive("payments");
      },
      goTo: (key: AdminKey, q?: string) => {
        if (q != null) setQueryState(q);
        setActive(key as Key);
        setNavOpen(false);
      },
      notifications,
      dismiss: (id: string) => setNotifications((n) => n.filter((x) => x.id !== id)),
    }),
    [query, active, role, notifications],
  );

  const logout = () => {
    api.adminLogout();
    try { window.dispatchEvent(new Event("mm-admin-unauthorized")); } catch { /* non-browser */ }
  };

  const View = VIEWS[active] ?? OverviewView;

  return (
   <AdminContext.Provider value={admin}>
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--paper)", color: "var(--ink)" }}>
      {/* sidebar */}
      <aside style={{
        position: "fixed", top: 0, left: 0, zIndex: 50, width: 232, height: "100vh", flex: "none",
        display: "flex", flexDirection: "column", background: "var(--surface)", borderRight: "1px solid var(--line)",
        transform: navOpen ? "none" : undefined, transition: "transform .25s ease",
      }} className="mm-admin-side" data-open={navOpen}>
        <div style={{ padding: "18px 18px 12px" }}><Logo size={24} src={brandLogo} /></div>
        <nav style={{ flex: 1, overflowY: "auto", padding: "4px 12px 12px" }}>
          {NAV.map((grp) => (
            <div key={grp.group ?? "root"} style={{ marginBottom: 6 }}>
              {grp.group && <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, color: "var(--ink-3)", padding: "10px 10px 4px" }}>{grp.group}</div>}
              {grp.items.map(([key, label]) => {
                const ok = canAccess(role, key);
                const on = active === key;
                return (
                  <button key={key} type="button" disabled={!ok} onClick={() => { setActive(key); setNavOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 10px", marginBottom: 1,
                      borderRadius: 9, border: "none", font: "inherit", textAlign: "left",
                      background: on ? "var(--accent-wash)" : "transparent", color: on ? "var(--accent)" : "var(--ink-2)",
                      fontWeight: on ? 700 : 600, fontSize: 13.5, opacity: ok ? 1 : 0.32, cursor: ok ? "pointer" : "not-allowed",
                    }}>
                    <Icon name={key} />
                    <span style={{ flex: 1 }}>{label}</span>
                    {key === "notifications" && ok && notifications.length > 0 && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, background: "var(--bad)", color: "#fff", borderRadius: 999, padding: "1px 6px" }}>{notifications.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderTop: "1px solid var(--line)" }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--accent)", color: "var(--accent-ink)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, flex: "none" }}>AM</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 650, fontSize: 13, whiteSpace: "nowrap" }}>A. Mbarga</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{role}</div>
          </div>
          <button type="button" onClick={logout} aria-label="Sign out" title="Sign out"
            style={{ border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink-2)", borderRadius: 8, padding: "5px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer", flex: "none" }}>
            Sign out
          </button>
        </div>
      </aside>

      {navOpen && (
        <button type="button" aria-label="Close menu" onClick={() => setNavOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 45, background: "oklch(0.2 0.01 64 / 0.42)", border: "none", cursor: "pointer" }} className="mm-admin-scrim" />
      )}

      {/* main */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", marginLeft: 232 }} className="mm-admin-main">
        <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 22px", borderBottom: "1px solid var(--line)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 20 }}>
          <button type="button" onClick={() => setNavOpen(true)} aria-label="Open menu"
            style={{ display: "none", border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "var(--ink)", lineHeight: 1 }} className="mm-admin-burger">≡</button>
          <div style={{ fontSize: 13.5 }}>
            <span style={{ color: "var(--ink-3)" }}>Admin</span> <span style={{ color: "var(--ink-3)" }}>/</span> <strong>{TITLES[active]}</strong>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 36, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface-2)" }} className="mm-admin-search">
            <span style={{ color: "var(--ink-3)" }} aria-hidden="true">⌕</span>
            <input aria-label="Search payments and customers" placeholder="Search payments, customers…"
              value={query} onChange={(e) => admin.setQuery(e.target.value)}
              style={{ border: "none", background: "transparent", font: "inherit", fontSize: 13, color: "var(--ink)", outline: "none", width: 200 }} />
            {query && <button type="button" aria-label="Clear search" onClick={() => admin.setQuery("")} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--ink-3)", fontSize: 14, lineHeight: 1 }}>✕</button>}
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Switch role"
            style={{ height: 36, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 13, fontWeight: 600, color: "var(--ink)", padding: "0 10px", cursor: "pointer" }}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Link to="/send" className="btn btn-ghost" style={{ padding: "8px 13px", fontSize: 13, textDecoration: "none" }}>Customer app ↗</Link>
        </header>
        <main style={{ flex: 1, padding: "22px", maxWidth: 1320, width: "100%", margin: "0 auto" }}>
          <View />
        </main>
      </div>

      {/* responsive behaviour without touching the global stylesheet */}
      <style>{`
        @media (max-width: 920px) {
          .mm-admin-side { transform: translateX(-100%); box-shadow: var(--shadow-pop); }
          .mm-admin-side[data-open="true"] { transform: none; }
          .mm-admin-main { margin-left: 0 !important; }
          .mm-admin-burger { display: inline-block !important; }
        }
        @media (min-width: 921px) {
          .mm-admin-scrim { display: none; }
        }
        @media (max-width: 560px) {
          .mm-admin-search { display: none !important; }
        }
      `}</style>
    </div>
   </AdminContext.Provider>
  );
}
