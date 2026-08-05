/* ============================================================
   /discover — "Pay with MoMo›Me". The public directory of accepting businesses:
   the piece that turns merchant supply into consumer demand (Growth Engine §3/§6).
   Browse/search opted-in merchants; tap Pay → /m/:code (open-amount checkout).
   No settlement numbers are ever exposed here.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MerchantDirectoryEntry } from "@shared/types.js";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { Spinner } from "../components/atoms.js";
import { api } from "../api/client.js";

const CATEGORIES = ["Restaurant", "Café / Bar", "Shop / Retail", "Hotel", "Freelancer", "Consultant", "Taxi / Transport", "Clinic", "Training centre", "Event / NGO"];
const cardStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)" };

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Discover() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [list, setList] = useState<MerchantDirectoryEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    setList(null);
    const id = setTimeout(() => {
      api.discover({ q: q.trim() || undefined, category: cat || undefined })
        .then((r) => { if (alive) setList(r.merchants); })
        .catch(() => { if (alive) setList([]); });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [q, cat]);

  const chipBase: React.CSSProperties = useMemo(() => ({ whiteSpace: "nowrap" }), []);

  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 40px" }}>
        <SiteHeader />
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: "clamp(26px,5vw,34px)", letterSpacing: "-0.02em" }}>Pay with MoMo›Me</h1>
          <p style={{ color: "var(--ink-2)", fontSize: 15, marginTop: 8, lineHeight: 1.6, maxWidth: "52ch" }}>
            Businesses that accept MoMo›Me — pay in crypto or Mobile Money, they get paid instantly. Find one and pay in seconds.
          </p>
        </div>

        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search businesses, category or area…" aria-label="Search"
          style={{ width: "100%", padding: "13px 15px", borderRadius: "var(--r-pill)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 16, color: "var(--ink)", outline: "none" }} />

        <div className="scroll-x" style={{ display: "flex", gap: 8, marginTop: 12, paddingBottom: 4 }}>
          <button type="button" className="chip" aria-pressed={!cat} style={chipBase} onClick={() => setCat(null)}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={cat === c} style={chipBase} onClick={() => setCat(cat === c ? null : c)}>{c}</button>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          {list === null && <div style={{ display: "grid", placeItems: "center", minHeight: "24vh" }}><Spinner size={22} /></div>}
          {list && list.length === 0 && (
            <div style={{ ...cardStyle, padding: 22, textAlign: "center", color: "var(--ink-2)" }}>
              <div style={{ fontSize: 15, fontWeight: 650 }}>No businesses here yet</div>
              <p style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>Be the first in your area. <Link to="/merchant" style={{ color: "var(--accent)", fontWeight: 600 }}>List your business →</Link></p>
            </div>
          )}
          {list && list.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {list.map((m) => (
                <div key={m.code} style={{ ...cardStyle, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 44, height: 44, borderRadius: 12, flex: "none", background: "var(--brand-wash)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>{initials(m.businessName)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.businessName}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.category}{m.location?.label ? ` · ${m.location.label}` : ""}</div>
                  </div>
                  <Link to={`/m/${m.code}`} className="btn btn-primary btn-sm" style={{ flex: "none", textDecoration: "none" }}>Pay</Link>
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
