/* ============================================================
   Application shell — left navigation (role-filtered), top bar (title,
   entity, environment, period, currency, notifications, profile), global
   filter bar, mobile drawer + bottom navigation. The customer app and the
   admin console keep their own shells; this one is for the decision surface.
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Logo, ThemeToggle } from "../../components/atoms.js";
import { api, setElevationPrompt } from "../../api/client.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { isInvestor, isReadOnly } from "@shared/roles.js";
import { PERIODS, type Period } from "@shared/capital.js";
import { COUNTRIES } from "@shared/domain.js";
import { navFor, titleFor } from "./nav.js";
import { can } from "../data/permissions.js";
import { useFilters } from "../data/filters.js";
import { capitalApi, DATA_SOURCE } from "../data/source.js";
import { useResource, ago } from "../data/hooks.js";
import { Badge } from "../components/ui.js";
import { GlobalSearch } from "../components/GlobalSearch.js";
import "../capital.css";

const PERIOD_LABEL: Record<Period, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "180d": "Last 180 days", "365d": "Last 12 months" };
const RAILS = ["ALL", "LIGHTNING", "ONCHAIN", "USDT", "USDC"] as const;
const PROVIDERS = ["ALL", "MTN", "ORANGE", "AIRTEL"] as const;

export function CapitalShell({ children, showFilters = true }: { children: ReactNode; showFilters?: boolean }) {
  const user = useAdminUser();
  const loc = useLocation();
  const { filters, set, reset } = useFilters();
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Step-up prompt. A money-shaped action (executing an allocation, posting a ledger
  // adjustment) answers 403 elevation_required; the client asks here, elevates the same
  // session, and replays the request once. Resolving null cancels.
  const [elevate, setElevate] = useState<{ resolve: (v: string | null) => void } | null>(null);
  const [elevatePw, setElevatePw] = useState("");
  useEffect(() => {
    setElevationPrompt(() => new Promise<string | null>((resolve) => { setElevatePw(""); setElevate({ resolve }); }));
    return () => setElevationPrompt(null);
  }, []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("mm_capital_nav") ?? "{}") as Record<string, boolean>; } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem("mm_capital_nav", JSON.stringify(collapsed)); } catch { /* blocked */ } }, [collapsed]);
  useEffect(() => { setOpen(false); setNotifOpen(false); }, [loc.pathname]);
  const groups = useMemo(() => navFor(user.role), [user.role]);
  const title = titleFor(loc.pathname);
  // RouteTitle (in App, a parent) sets the generic "Capital · MoMo›Me" in ITS effect, which
  // runs after this child's — so apply the precise page title a microtask later.
  useEffect(() => { queueMicrotask(() => { document.title = `${title} · MoMo›Me Capital`; }); }, [title, loc.pathname]);
  const config = useResource(() => api.getConfig(), [], {});
  const env = config.data ? (config.data.demoMode ? "Sandbox" : "Live") : null;
  const notifs = useResource(() => capitalApi.notifications(), [], { pollMs: 60_000, enabled: !isInvestor(user.role) });
  const unread = (notifs.data?.notifications ?? []).filter((n) => !n.readAt);
  const bottom = groups.filter((g) => ["overview", "ios", "capital", "ai", "settings"].includes(g.key)).slice(0, 4);

  const logout = () => { api.adminLogout(); try { window.dispatchEvent(new CustomEvent("mm-admin-unauthorized", { detail: { reason: "signout" } })); } catch { /* non-browser */ } };

  return (
    <div className="cap">
      {elevate && (
        <div className="cap-modal-bg" role="presentation" onClick={() => { elevate.resolve(null); setElevate(null); }}>
          <div className="cap-modal" role="dialog" aria-modal="true" aria-label="Confirm your password" style={{ width: "min(400px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="cap-card-h"><div><h2>Confirm your password</h2><div className="cap-sub" style={{ marginTop: 4 }}>This action deploys capital or changes a ledger. Re-enter your password to confirm — it stays confirmed for a few minutes.</div></div></div>
            <form className="cap-card-b" onSubmit={(e) => { e.preventDefault(); elevate.resolve(elevatePw); setElevate(null); }}>
              <input className="cap-input" type="password" autoFocus value={elevatePw} onChange={(e) => setElevatePw(e.target.value)} placeholder="Password" aria-label="Password" />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}><button type="button" className="cap-btn" onClick={() => { elevate.resolve(null); setElevate(null); }}>Cancel</button><button type="submit" className="cap-btn primary" disabled={!elevatePw}>Confirm</button></div>
            </form>
          </div>
        </div>
      )}
      {DATA_SOURCE === "mock" && <div className="cap-mock" role="status">DEVELOPMENT DATA SOURCE: MOCK — every figure on these pages is fictional. Set VITE_CAPITAL_DATA_SOURCE=api for live data.</div>}
      <div className="cap-shell">
        <aside className="cap-side" data-open={open} aria-label="Capital navigation">
          <div style={{ padding: "16px 16px 8px", display: "flex", alignItems: "center", gap: 10 }}><Logo size={26} /><span style={{ fontWeight: 750, fontSize: 13, color: "var(--ink-2)" }}>Capital</span></div>
          <nav className="cap-nav">
            {groups.map((g) => {
              const isCollapsed = !!collapsed[g.key];
              if (g.to && g.items.length === 0) return <div key={g.key} className="cap-nav-group"><NavLink to={g.to} end className={({ isActive }) => (isActive ? "active" : "")}>{g.label}</NavLink></div>;
              return (
                <div key={g.key} className="cap-nav-group">
                  <button type="button" className="cap-nav-head" aria-expanded={!isCollapsed} onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}><span>{g.label}</span><span aria-hidden>{isCollapsed ? "+" : "−"}</span></button>
                  {!isCollapsed && g.items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === "/capital-intelligence" || i.to === "/investments" || i.to === "/capital" || i.to === "/ai-copilot" || i.to === "/reports"} className={({ isActive }) => (isActive ? "active" : "")}>{i.label}{i.to === "/capital-intelligence/recommendations" && unread.some((n) => n.kind === "APPROVAL_REQUIRED") && <span className="cap-badge" data-tone="warn">approval</span>}</NavLink>)}
                </div>
              );
            })}
          </nav>
          {/* The one deliberate link back to the operator console — a button, not a menu entry. */}
          {can(user.role, "view:operations") && <div style={{ padding: "10px 12px", borderTop: "1px solid var(--line)" }}><Link to="/admin" className="cap-btn sm" style={{ textDecoration: "none" }}>Open MoMo›Me console ↗</Link></div>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
            <div aria-hidden style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--brand)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 750, fontSize: 12, textTransform: "uppercase" }}>{user.username.slice(0, 2)}</div>
            <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 650, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.username}</div><div className="cap-sub">{user.role}{isReadOnly(user.role) && " · view only"}</div></div>
            <button type="button" className="cap-btn sm" onClick={logout}>Sign out</button>
          </div>
        </aside>
        <button type="button" className="cap-scrim" data-open={open} aria-label="Close menu" onClick={() => setOpen(false)} />

        <div className="cap-main">
          <header className="cap-top">
            <button type="button" className="cap-burger" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>≡</button>
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 750, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div><div className="cap-sub" style={{ display: "flex", gap: 6, alignItems: "center" }}>MoMo›Me · CEMAC {env && <Badge tone={env === "Live" ? "good" : "warn"}>{env}</Badge>}{DATA_SOURCE === "mock" && <Badge tone="warn">MOCK</Badge>}</div></div>
            <div style={{ flex: 1 }} />
            {!isInvestor(user.role) && <GlobalSearch />}
            {showFilters && !isInvestor(user.role) && (
              <div className="cap-toolbar" aria-label="Global filters">
                <select className="cap-select" aria-label="Date range" value={filters.period} onChange={(e) => set({ period: e.target.value as Period })}>{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select>
                <select className="cap-select" aria-label="Currency" value={filters.ccy} onChange={(e) => set({ ccy: e.target.value as typeof filters.ccy })}><option value="XAF">XAF</option><option value="USD">USD</option></select>
              </div>
            )}
            {showFilters && !isInvestor(user.role) && <button type="button" className="cap-btn cap-filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>Filters</button>}
            <div style={{ position: "relative" }}>
              {!isInvestor(user.role) && <button type="button" className="cap-btn" aria-label={`Notifications, ${unread.length} unread`} aria-expanded={notifOpen} onClick={() => setNotifOpen((v) => !v)}>🔔{unread.length > 0 && <span className="cap-badge" data-tone={unread.some((n) => n.severity === "critical") ? "bad" : "warn"}>{unread.length}</span>}</button>}
              {notifOpen && <NotificationPanel items={notifs.data?.notifications ?? []} loading={notifs.loading} onRead={async (id) => { await capitalApi.markRead(id); notifs.refresh(); }} onClose={() => setNotifOpen(false)} />}
            </div>
            <ThemeToggle size={34} />
          </header>
          {showFilters && !isInvestor(user.role) && (
            <div className="cap-toolbar cap-filters" data-open={filtersOpen} style={{ padding: "8px 20px", borderBottom: "1px solid var(--line)", background: "var(--surface)", fontSize: 12.5 }} aria-label="Data filters">
              <span className="cap-sub">Filter</span>
              <select className="cap-select" aria-label="Country" value={filters.country} onChange={(e) => set({ country: e.target.value as typeof filters.country })}><option value="ALL">All countries</option>{Object.values(COUNTRIES).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
              <select className="cap-select" aria-label="Payment rail" value={filters.rail} onChange={(e) => set({ rail: e.target.value as typeof filters.rail })}>{RAILS.map((r) => <option key={r} value={r}>{r === "ALL" ? "All rails" : r}</option>)}</select>
              <select className="cap-select" aria-label="Provider" value={filters.provider} onChange={(e) => set({ provider: e.target.value as typeof filters.provider })}>{PROVIDERS.map((p) => <option key={p} value={p}>{p === "ALL" ? "All providers" : p}</option>)}</select>
              <select className="cap-select" aria-label="Capital type" value={filters.capitalType} onChange={(e) => set({ capitalType: e.target.value as typeof filters.capitalType })}><option value="ALL">All capital</option><option value="OWN">OWN · Equity</option><option value="POWER">POWER · Liquidity</option><option value="SCALE">SCALE · Growth</option><option value="STRATEGIC">Strategic</option></select>
              <select className="cap-select" aria-label="Scenario" value={filters.scenario} onChange={(e) => set({ scenario: e.target.value as typeof filters.scenario })}><option value="CONSERVATIVE">Conservative</option><option value="BASE">Base</option><option value="AGGRESSIVE">Aggressive</option></select>
              {(filters.country !== "ALL" || filters.rail !== "ALL" || filters.provider !== "ALL" || filters.capitalType !== "ALL" || filters.period !== "30d") && <button type="button" className="cap-btn sm quiet" onClick={reset}>Reset</button>}
            </div>
          )}
          <main className="cap-content" id="cap-main">{children}</main>
        </div>
        <nav className="cap-bottom" aria-label="Primary">{bottom.map((g) => { const to = g.to ?? g.items[0]?.to ?? "/"; return <NavLink key={g.key} to={to} className={({ isActive }) => (isActive || loc.pathname.split("/")[1] === to.split("/")[1] ? "active" : "")}><span aria-hidden>{({ overview: "◫", ios: "◉", capital: "◧", ai: "✦", settings: "⚙" } as Record<string, string>)[g.key]}</span>{g.label.replace("Investor OS", "Investors").replace("AI Copilot", "Copilot")}</NavLink>; })}</nav>
      </div>
    </div>
  );
}

function NotificationPanel({ items, loading, onRead, onClose }: { items: Array<{ id: string; at: string; kind: string; severity: string; title: string; text: string; href: string; readAt?: string }>; loading: boolean; onRead: (id: string) => void; onClose: () => void }) {
  const nav = useNavigate();
  return (
    <div role="dialog" aria-label="Notifications" className="cap-card" style={{ position: "absolute", right: 0, top: 40, width: "min(380px, 92vw)", zIndex: 60, maxHeight: "70vh", overflowY: "auto", boxShadow: "var(--shadow-pop)" }}>
      <div className="cap-card-h" style={{ alignItems: "center" }}><h2>Notifications</h2><button type="button" className="cap-btn quiet sm" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="cap-card-b">
        {loading && <div className="cap-skel" style={{ height: 40 }} />}
        {!loading && items.length === 0 && <div className="cap-sub">Nothing needs your attention.</div>}
        {items.slice(0, 30).map((n) => (
          <button key={n.id} type="button" onClick={() => { onRead(n.id); nav(n.href); onClose(); }} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", background: n.readAt ? "transparent" : "var(--surface-2)", border: 0, borderBottom: "1px solid var(--line-2)", padding: "8px 6px", cursor: "pointer", color: "inherit" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Badge tone={n.severity === "critical" ? "bad" : n.severity === "warn" ? "warn" : "info"}>{n.kind.replace(/_/g, " ").toLowerCase()}</Badge><span className="cap-sub">{ago(n.at)}</span></div>
            <div style={{ fontWeight: n.readAt ? 500 : 700, marginTop: 3 }}>{n.title}</div><div className="cap-sub">{n.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
