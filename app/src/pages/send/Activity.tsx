import { useEffect, useState } from "react";
import type { Payment, DisplayStatus } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { fmt, initials } from "../../lib/format.js";
import { useI18n } from "../../lib/i18n.js";
import { api } from "../../api/client.js";
import { FlowCard } from "./ui.js";
import { Spinner } from "../../components/atoms.js";
import { Receipt } from "./Success.js";

const ST_TONE: Record<DisplayStatus, string> = { Completed: "var(--recv)", Pending: "var(--warn)", Failed: "var(--bad)" };
type Filter = "All" | DisplayStatus;

function rel(p: Payment): string {
  const days = Math.floor((Date.now() - Date.parse(p.createdAt)) / 86400_000);
  if (days <= 0) return new Date(p.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return new Date(p.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function Activity() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [receipt, setReceipt] = useState<Payment | null>(null);

  useEffect(() => {
    let active = true;
    api.listPayments().then((p) => { if (active) setRows(p); }).catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, []);

  const TSTAT: Record<Filter, string> = { All: t("all"), Completed: t("completed"), Pending: t("pending"), Failed: t("failed") };
  const visible = (rows ?? []).filter((r) => filter === "All" || r.displayStatus === filter);

  return (
    <FlowCard>
      <h2 style={{ fontSize: 24 }}>{t("activity_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 18px" }}>{t("activity_sub")}</p>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {(["All", "Completed", "Pending", "Failed"] as Filter[]).map((x) => (
          <button key={x} onClick={() => setFilter(x)}
            style={{ flex: 1, cursor: "pointer", padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 650, fontFamily: "inherit", border: `1px solid ${filter === x ? "var(--accent)" : "var(--line)"}`, background: filter === x ? "var(--accent-wash)" : "var(--surface)", color: filter === x ? "var(--accent)" : "var(--ink-2)" }}>
            {TSTAT[x]}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "40px 0", color: "var(--ink-3)" }}>
          <Spinner size={16} /> {t("loading")}
        </div>
      ) : (
        <div>
          {visible.map((r, i) => {
            const openable = r.displayStatus === "Completed";
            return (
              <button key={r.id} type="button" disabled={!openable} onClick={() => openable && setReceipt(r)}
                style={{ width: "100%", textAlign: "left", font: "inherit", display: "flex", alignItems: "center", gap: 12, padding: "13px 8px", margin: "0 -8px", borderRadius: 10, border: "none", borderBottom: i < visible.length - 1 ? "1px solid var(--line-2)" : "none", background: "transparent", cursor: openable ? "pointer" : "default" }}
                onMouseEnter={(e) => { if (openable) e.currentTarget.style.background = "var(--surface-2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--surface-2)", border: "1px solid var(--line)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, color: "var(--ink-2)", flex: "none" }}>{initials(r.recipient.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.recipient.name}</div>
                  <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{COUNTRIES[r.recipient.country].dial} {r.recipient.phone}</div>
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div className="num" style={{ fontWeight: 700, fontSize: 14 }}>{fmt(r.xaf)} XAF</div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: ST_TONE[r.displayStatus], marginTop: 1 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: ST_TONE[r.displayStatus] }} />{TSTAT[r.displayStatus]} · {rel(r)}
                  </div>
                </div>
              </button>
            );
          })}
          {visible.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 13.5, padding: "30px 0" }}>
              {filter === "All" ? t("no_payments_all") : t("no_payments_filtered")}
            </div>
          )}
        </div>
      )}

      {receipt && <Receipt payment={receipt} onClose={() => setReceipt(null)} />}
    </FlowCard>
  );
}
