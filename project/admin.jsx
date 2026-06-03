/* ============================================================
   MoMo›Me Admin — shell (sidebar · topbar · router)
   ============================================================ */
const { useState: useStateA, useEffect: useEffectA } = React;

/* ---- icons (simple monochrome primitives) ---- */
function Icon({ name, s = 17 }) {
  const p = { width: s, height: s, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
  const I = {
    overview: <g><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></g>,
    payments: <g><path d="M2 5h10l-2-2M14 11H4l2 2" /></g>,
    delivery: <g><circle cx="8" cy="8" r="6" /><path d="M5.5 8l1.8 1.8L10.5 6" /></g>,
    liquidity: <g><path d="M2 5h12M2 8h12M2 11h12" /></g>,
    pricing: <g><circle cx="5" cy="5" r="1.4" /><circle cx="11" cy="11" r="1.4" /><path d="M12 4L4 12" /></g>,
    "mobile-money": <g><rect x="4.5" y="2" width="7" height="12" rx="1.5" /><path d="M7 12h2" /></g>,
    rails: <g><path d="M9 2L3.5 9H8l-1 5 5.5-7H8z" /></g>,
    customers: <g><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" /></g>,
    identities: <g><circle cx="8" cy="8" r="2" /><circle cx="3" cy="4" r="1.3" /><circle cx="13" cy="4" r="1.3" /><circle cx="8" cy="14" r="1.3" /><path d="M6.6 6.7L4 5M9.4 6.7L12 5M8 10v2.7" /></g>,
    compliance: <g><path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" /><path d="M6 8l1.5 1.5L10.5 6.5" /></g>,
    reports: <g><path d="M4 13V8M8 13V4M12 13v-3" /></g>,
    notifications: <g><path d="M8 2a4 4 0 00-4 4c0 4-1.5 5-1.5 5h11S12 10 12 6a4 4 0 00-4-4z" /><path d="M6.8 14a1.4 1.4 0 002.4 0" /></g>,
    health: <g><path d="M2 8h3l1.5-4 3 8L13 8h1" /></g>,
    settings: <g><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" /></g>,
    administration: <g><circle cx="6" cy="8" r="2.5" /><path d="M8.2 8H14M12 8v2.5M10 8v1.8" /></g>,
  };
  return <svg {...p}>{I[name] || I.overview}</svg>;
}

const NAV = [
  { group: null, items: [["overview", "Overview"]] },
  { group: "Operations", items: [["payments", "Payments"], ["delivery", "Delivery"]] },
  { group: "Treasury", items: [["liquidity", "Liquidity"], ["pricing", "Rates & Pricing"]] },
  { group: "Rails", items: [["mobile-money", "Mobile Money"], ["rails", "Crypto Rails"]] },
  { group: "Identity", items: [["identities", "Identities"]] },
  { group: "Risk", items: [["customers", "Customers"], ["compliance", "Compliance"]] },
  { group: "Insights", items: [["reports", "Reports"], ["notifications", "Notifications"], ["health", "System Health"]] },
  { group: "System", items: [["settings", "Settings"], ["administration", "Administration"]] },
];
const TITLES = Object.fromEntries(NAV.flatMap((g) => g.items));

const ROLES = ["Super Admin", "Operations", "Finance", "Compliance", "Support", "Read Only"];
const ROLE_ACCESS = {
  "Super Admin": "all",
  "Read Only": "all",
  Operations: ["overview", "payments", "delivery", "liquidity", "identities", "health", "notifications"],
  Finance: ["overview", "pricing", "liquidity", "reports"],
  Compliance: ["overview", "customers", "identities", "compliance", "notifications"],
  Support: ["overview", "customers", "identities", "payments"],
};
const canAccess = (role, key) => { const a = ROLE_ACCESS[role]; return a === "all" || a.includes(key); };

/* ---- tweaks ---- */
const A_FONTS = {
  warm: { display: '"Bricolage Grotesque", sans-serif', body: '"Hanken Grotesk", sans-serif' },
  geometric: { display: '"Space Grotesk", sans-serif', body: '"Public Sans", sans-serif' },
};
function useAdminTweaks(t) {
  useEffectA(() => {
    const r = document.documentElement;
    r.dataset.theme = t.dark ? "dark" : "light";
    r.dataset.accent = t.accent;
    r.dataset.density = t.density;
    const fp = A_FONTS[t.fontPair] || A_FONTS.warm;
    r.style.setProperty("--font-display", fp.display);
    r.style.setProperty("--font-body", fp.body);
  }, [t]);
}

const A_DEFAULTS = /*EDITMODE-BEGIN*/{ "accent": "clay", "dark": false, "fontPair": "warm", "density": "cozy" }/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(A_DEFAULTS);
  useAdminTweaks(t);
  const [active, setActive] = useStateA(() => localStorage.getItem("mm_admin_section") || "overview");
  const [role, setRole] = useStateA("Super Admin");
  const [navOpen, setNavOpen] = useStateA(false);
  useEffectA(() => { localStorage.setItem("mm_admin_section", active); }, [active]);
  useEffectA(() => { if (!canAccess(role, active)) setActive("overview"); }, [role]);

  const View = window.VIEWS[active] || window.VIEWS.overview;

  return (
    <div className="admin">
      {/* sidebar */}
      <aside className={"side" + (navOpen ? " open" : "")}>
        <div className="side-brand"><Logo size={24} /></div>
        <nav className="side-nav">
          {NAV.map((grp, gi) => (
            <div key={gi} style={{ marginBottom: 6 }}>
              {grp.group && <div className="side-grp">{grp.group}</div>}
              {grp.items.map(([key, label]) => {
                const ok = canAccess(role, key);
                const on = active === key;
                return (
                  <button key={key} disabled={!ok} onClick={() => { setActive(key); setNavOpen(false); }}
                    className={"side-item" + (on ? " on" : "")} style={{ opacity: ok ? 1 : 0.32, cursor: ok ? "pointer" : "not-allowed" }}>
                    <Icon name={key} />
                    <span className="side-lbl">{label}</span>
                    {key === "notifications" && ok && <span className="side-badge">6</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--accent)", color: "var(--accent-ink)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, flex: "none" }}>AM</div>
          <div className="side-lbl" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 13, whiteSpace: "nowrap" }}>A. Mbarga</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{role}</div>
          </div>
        </div>
      </aside>

      {navOpen && <div className="side-scrim" onClick={() => setNavOpen(false)} />}

      {/* main */}
      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setNavOpen(true)} aria-label="Menu">≡</button>
          <div className="crumbs"><span style={{ color: "var(--ink-3)" }}>Admin</span> <span style={{ color: "var(--ink-3)" }}>/</span> <strong>{TITLES[active]}</strong></div>
          <div style={{ flex: 1 }} />
          <div className="search">
            <span style={{ color: "var(--ink-3)" }}>⌕</span>
            <input placeholder="Search payments, customers…" />
          </div>
          <div style={{ position: "relative" }}>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="role-sel">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <a href="MoMoMe Send Flow.html" className="btn btn-ghost" style={{ padding: "8px 13px", fontSize: 13, textDecoration: "none" }}>Customer app ↗</a>
        </header>
        <main className="content">
          <View />
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakRadio label="Accent" value={t.accent} options={["clay", "green", "violet", "ink"]} onChange={(v) => setTweak("accent", v)} />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakSection label="Type" />
        <TweakRadio label="Font" value={t.fontPair} options={["warm", "geometric"]} onChange={(v) => setTweak("fontPair", v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["compact", "cozy", "comfortable"]} onChange={(v) => setTweak("density", v)} />
      </TweaksPanel>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
