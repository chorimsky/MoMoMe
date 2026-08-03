import { useEffect, useState } from "react";
import type { Payment, DisplayStatus } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { fmt, initials } from "../../lib/format.js";
import { useI18n } from "../../lib/i18n.js";
import { api } from "../../api/client.js";
import { FlowCard } from "./ui.js";
import { Spinner } from "../../components/atoms.js";
import { Receipt } from "./Success.js";
import { RefundClaim } from "./steps.js";

const ST_TONE: Record<DisplayStatus, string> = { Completed: "var(--recv)", Pending: "var(--warn)", Failed: "var(--bad)" };
type Filter = "All" | DisplayStatus;
/** A payout that couldn't land and is waiting for the sender to supply a refund
 *  invoice — the ONLY way to reclaim the held crypto, so it must stay reachable. */
const needsRefund = (r: Payment) => r.state === "REFUND_PENDING" && !!r.refundNeedsDestination;

function rel(p: Payment, lang: "en" | "fr", yesterday: string): string {
  const loc = lang === "fr" ? "fr-FR" : "en-GB";
  const days = Math.floor((Date.now() - Date.parse(p.createdAt)) / 86400_000);
  if (days <= 0) return new Date(p.createdAt).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return yesterday;
  return new Date(p.createdAt).toLocaleDateString(loc, { day: "2-digit", month: "short" });
}

export function Activity() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const [refunding, setRefunding] = useState<Payment | null>(null);

  const reload = () => api.listPayments().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    let active = true;
    api.listPayments().then((p) => { if (active) setRows(p); }).catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, []);

  // A stranded refund takes over the view (same as the processing screen does) so the
  // sender always has a path to reclaim their crypto — never a dead "Pending" row.
  if (refunding) return <RefundClaim payment={refunding} reset={() => { setRefunding(null); void reload(); }} />;

  const TSTAT: Record<Filter, string> = { All: t("all"), Completed: t("completed"), Pending: t("pending"), Failed: t("failed") };
  const visible = (rows ?? []).filter((r) => filter === "All" || r.displayStatus === filter);

  return (
    <FlowCard>
      <h2 style={{ fontSize: 20 }}>{t("activity_title")}</h2>
      <p style={{ color: "var(--ink-2)", fontSize: 13.5, margin: "3px 0 12px" }}>{t("activity_sub")}</p>
      <div role="group" aria-label={t("activity_title")} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {(["All", "Completed", "Pending", "Failed"] as Filter[]).map((x) => (
          <button key={x} onClick={() => setFilter(x)} aria-pressed={filter === x}
            style={{ flex: 1, cursor: "pointer", padding: "11px 0", minHeight: 42, borderRadius: 9, fontSize: 12.5, fontWeight: 650, fontFamily: "inherit", border: `1px solid ${filter === x ? "var(--accent)" : "var(--line)"}`, background: filter === x ? "var(--accent-wash)" : "var(--surface)", color: filter === x ? "var(--accent)" : "var(--ink-2)" }}>
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
            const refund = needsRefund(r);
            const openable = r.displayStatus === "Completed" || refund;
            return (
              <button key={r.id} type="button" disabled={!openable} onClick={() => { if (refund) setRefunding(r); else if (r.displayStatus === "Completed") setReceipt(r); }}
                style={{ width: "100%", textAlign: "left", font: "inherit", display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", margin: "0 -8px", borderRadius: 10, border: "none", borderBottom: i < visible.length - 1 ? "1px solid var(--line-2)" : "none", background: refund ? "var(--bad-wash)" : "transparent", cursor: openable ? "pointer" : "default" }}
                onMouseEnter={(e) => { if (openable && !refund) e.currentTarget.style.background = "var(--surface-2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = refund ? "var(--bad-wash)" : "transparent"; }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--surface-2)", border: "1px solid var(--line)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, color: "var(--ink-2)", flex: "none" }}>{initials(r.recipient.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.recipient.name || t("mm_recipient")}</div>
                  <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{COUNTRIES[r.recipient.country]?.dial ?? ""} {r.recipient.phone}</div>
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div className="num" style={{ fontWeight: 700, fontSize: 14 }}>{fmt(r.xaf)} XAF</div>
                  {refund ? (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "var(--bad)", marginTop: 1 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--bad)" }} />{t("refund_needed")} →
                    </div>
                  ) : (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: ST_TONE[r.displayStatus], marginTop: 1 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ST_TONE[r.displayStatus] }} />{TSTAT[r.displayStatus]} · {rel(r, lang, t("yesterday"))}
                    </div>
                  )}
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
