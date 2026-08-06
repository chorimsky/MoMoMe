/* ============================================================
   /discover — "Pay with MoMo›Me". The public directory of accepting businesses:
   the piece that turns merchant supply into consumer demand (Growth Engine §3/§6).
   Browse/search opted-in merchants; tap Pay → /m/:code (open-amount checkout).
   No settlement numbers are ever exposed here.
   ============================================================ */
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import type { MerchantDirectoryEntry } from "@shared/types.js";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { Spinner } from "../components/atoms.js";
import { useI18n } from "../lib/i18n.js";
import { CATEGORIES, catLabel } from "../lib/categories.js";
import { api } from "../api/client.js";

// Leaflet is heavy — only pull it in when the map view is actually opened.
const MerchantMap = lazy(() => import("../components/MerchantMap.js").then((m) => ({ default: m.MerchantMap })));

/** A merchant we could geocode → can be plotted. Mirrors MerchantMap.pinnable. */
const hasPin = (m: MerchantDirectoryEntry) => typeof m.location?.lat === "number" && typeof m.location?.lng === "number";

const cardStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)" };

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Discover() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [list, setList] = useState<MerchantDirectoryEntry[] | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setList(null);
    setSelected(null);
    const id = setTimeout(() => {
      api.discover({ q: q.trim() || undefined, category: cat || undefined })
        .then((r) => { if (alive) setList(r.merchants); })
        .catch(() => { if (alive) setList([]); });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [q, cat]);

  const chipBase: React.CSSProperties = useMemo(() => ({ whiteSpace: "nowrap" }), []);
  const mapped = useMemo(() => (list ?? []).filter(hasPin), [list]);
  const selectedMerchant = useMemo(() => (list ?? []).find((m) => m.code === selected) ?? null, [list, selected]);

  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 40px" }}>
        <SiteHeader />
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: "clamp(26px,5vw,34px)", letterSpacing: "-0.02em" }}>{t("disc_title")}</h1>
          <p style={{ color: "var(--ink-2)", fontSize: 15, marginTop: 8, lineHeight: 1.6, maxWidth: "52ch" }}>{t("disc_sub")}</p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("disc_search")} aria-label={t("disc_search")}
            style={{ flex: 1, minWidth: 0, padding: "13px 15px", borderRadius: "var(--r-pill)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 16, color: "var(--ink)", outline: "none" }} />
          <Link to="/scan" aria-label={t("scan_cta")} title={t("scan_cta")} className="btn btn-primary" style={{ flex: "none", padding: "0 16px", textDecoration: "none" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M4 12h16" /></svg>
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <div className="scroll-x" style={{ display: "flex", gap: 8, flex: 1, minWidth: 0, paddingBottom: 4 }}>
            <button type="button" className="chip" aria-pressed={!cat} style={chipBase} onClick={() => setCat(null)}>{t("disc_all")}</button>
            {CATEGORIES.filter((c) => c.value !== "Other").map((c) => (
              <button key={c.value} type="button" className="chip" aria-pressed={cat === c.value} style={chipBase} onClick={() => setCat(cat === c.value ? null : c.value)}>{c[lang]}</button>
            ))}
          </div>
          {/* List ⇄ Map segmented control */}
          <div style={{ flex: "none", display: "inline-flex", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 999, padding: 3 }}>
            {(["list", "map"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 999, border: "none", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 650, color: view === v ? "#fff" : "var(--ink-2)", background: view === v ? "var(--accent)" : "transparent" }}>
                {v === "list"
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z" /><path d="M9 3v16M15 5v16" /></svg>}
                {v === "list" ? t("disc_view_list") : t("disc_view_map")}
              </button>
            ))}
          </div>
        </div>

        {view === "map" && (
          <div style={{ marginTop: 14 }}>
            {list === null ? (
              <div style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}><Spinner size={22} /></div>
            ) : mapped.length === 0 ? (
              <div style={{ ...cardStyle, padding: 22, textAlign: "center", color: "var(--ink-2)" }}>
                <div style={{ fontSize: 15, fontWeight: 650 }}>{t("disc_map_empty")}</div>
                <p style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 6 }}><Link to="/merchant" style={{ color: "var(--accent)", fontWeight: 600 }}>{t("disc_list_biz")}</Link></p>
              </div>
            ) : (
              <div style={{ position: "relative", height: "min(62vh, 560px)", borderRadius: "var(--r-lg)", overflow: "hidden", border: "1px solid var(--line)", boxShadow: "var(--shadow-sm)" }}>
                <Suspense fallback={<div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "var(--surface-2)" }}><Spinner size={22} /></div>}>
                  <MerchantMap merchants={mapped} selectedCode={selected} onSelect={setSelected} />
                </Suspense>
                {/* Floating pay card for the tapped pin (Google-Maps style). */}
                {selectedMerchant ? (
                  <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 500, ...cardStyle, padding: 13, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.18)" }}>
                    <span style={{ width: 44, height: 44, borderRadius: 12, flex: "none", background: "var(--brand-wash)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>{initials(selectedMerchant.businessName)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedMerchant.businessName}</span>
                        {selectedMerchant.verifiedPhone && <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--recv)" aria-label={t("disc_verified")} style={{ flex: "none" }}><path d="M12 2 14.9 4.9 19 4.6 18.7 8.7 21.6 11.6 18.7 14.5 19 18.6 14.9 18.3 12 21.2 9.1 18.3 5 18.6 5.3 14.5 2.4 11.6 5.3 8.7 5 4.6 9.1 4.9z" /><path d="M10.6 14.6 8 12l-1.1 1.1 3.7 3.7 6-6L15.5 9.7z" fill="#fff" /></svg>}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catLabel(selectedMerchant.category, lang)}{selectedMerchant.location?.label ? ` · ${selectedMerchant.location.label}` : ""}</div>
                    </div>
                    <Link to={`/m/${selectedMerchant.code}`} className="btn btn-primary btn-sm" style={{ flex: "none", textDecoration: "none" }}>{t("lp_cta_pay")}</Link>
                  </div>
                ) : (
                  <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 500, textAlign: "center", pointerEvents: "none" }}>
                    <span style={{ display: "inline-block", padding: "7px 14px", borderRadius: 999, background: "var(--surface)", border: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-2)", boxShadow: "var(--shadow-sm)" }}>{t("disc_tap_pin")}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, display: view === "list" ? "block" : "none" }}>
          {list === null && <div style={{ display: "grid", placeItems: "center", minHeight: "24vh" }}><Spinner size={22} /></div>}
          {list && list.length === 0 && (
            <div style={{ ...cardStyle, padding: 22, textAlign: "center", color: "var(--ink-2)" }}>
              <div style={{ fontSize: 15, fontWeight: 650 }}>{t("disc_empty_t")}</div>
              <p style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>{t("disc_empty_d")} <Link to="/merchant" style={{ color: "var(--accent)", fontWeight: 600 }}>{t("disc_list_biz")}</Link></p>
            </div>
          )}
          {list && list.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {list.map((m) => (
                <div key={m.code} style={{ ...cardStyle, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 44, height: 44, borderRadius: 12, flex: "none", background: "var(--brand-wash)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>{initials(m.businessName)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{m.businessName}</span>
                      {m.verifiedPhone && (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--recv)" aria-label="Verified" style={{ flex: "none" }}><path d="M12 2 14.9 4.9 19 4.6 18.7 8.7 21.6 11.6 18.7 14.5 19 18.6 14.9 18.3 12 21.2 9.1 18.3 5 18.6 5.3 14.5 2.4 11.6 5.3 8.7 5 4.6 9.1 4.9z" /><path d="M10.6 14.6 8 12l-1.1 1.1 3.7 3.7 6-6L15.5 9.7z" fill="#fff" /></svg>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catLabel(m.category, lang)}{m.location?.label ? ` · ${m.location.label}` : ""}</div>
                  </div>
                  <Link to={`/m/${m.code}`} className="btn btn-primary btn-sm" style={{ flex: "none", textDecoration: "none" }}>{t("lp_cta_pay")}</Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
