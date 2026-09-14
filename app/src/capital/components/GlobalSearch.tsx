/* ============================================================
   Global search — investors, transactions, requirements, investments,
   documents, recommendations, reports, opportunities. The server filters
   each category by the caller's sections, so results never leak across roles.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SearchHit } from "@shared/capital.js";
import { capitalApi } from "../data/source.js";
import { Badge } from "./ui.js";

const KIND_LABEL: Record<SearchHit["kind"], string> = { investor: "Investor", transaction: "Transaction", requirement: "Requirement", investment: "Investment", document: "Document", recommendation: "Recommendation", report: "Report", opportunity: "Opportunity" };

export function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const gen = useRef(0);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits([]); return; }
    const g = ++gen.current; setBusy(true);
    const t = setTimeout(() => { capitalApi.search(s).then((r) => { if (g === gen.current) { setHits(r.hits); setActive(0); } }).catch(() => { if (g === gen.current) setHits([]); }).finally(() => { if (g === gen.current) setBusy(false); }); }, 220);
    return () => clearTimeout(t);
  }, [q]);
  const go = (h: SearchHit) => { setOpen(false); setQ(""); nav(h.href); };
  return (
    <div style={{ position: "relative" }} className="cap-search">
      <input className="cap-input" role="combobox" aria-expanded={open && hits.length > 0} aria-controls="cap-search-list" aria-label="Search investors, transactions, requirements, documents, reports" placeholder="Search…" value={q} style={{ width: 220 }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); } if (e.key === "Enter" && hits[active]) go(hits[active]); if (e.key === "Escape") setOpen(false); }} />
      {open && q.trim().length >= 2 && (
        <div id="cap-search-list" role="listbox" className="cap-card" style={{ position: "absolute", top: 40, left: 0, width: "min(460px, 92vw)", zIndex: 60, maxHeight: "60vh", overflowY: "auto", boxShadow: "var(--shadow-pop)" }}>
          {busy && hits.length === 0 && <div className="cap-state">Searching…</div>}
          {!busy && hits.length === 0 && <div className="cap-state">No results for “{q}”.</div>}
          {hits.map((h, i) => <button key={`${h.kind}-${h.id}`} type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", font: "inherit", padding: "8px 12px", border: 0, borderBottom: "1px solid var(--line-2)", background: i === active ? "var(--surface-2)" : "transparent", color: "inherit", cursor: "pointer" }}><Badge>{KIND_LABEL[h.kind]}</Badge><span style={{ minWidth: 0 }}><div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</div><div className="cap-sub">{h.sub}</div></span></button>)}
        </div>
      )}
    </div>
  );
}
