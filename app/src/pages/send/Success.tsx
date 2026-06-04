import { useState } from "react";
import type { Payment } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { Logo, Momo } from "../../components/atoms.js";
import { fmt } from "../../lib/format.js";
import { useI18n } from "../../lib/i18n.js";
import { FlowCard, Row } from "./ui.js";

function fullPhone(p: Payment): string {
  return COUNTRIES[p.recipient.country].dial + " " + p.recipient.phone;
}
function when(p: Payment): string {
  return new Date(p.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function Receipt({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { t } = useI18n();
  const rows: Array<[string, string]> = [
    [t("recipient"), payment.recipient.name || "—"],
    [t("mobile_number"), fullPhone(payment)],
    [t("amount_delivered"), fmt(payment.xaf) + " XAF"],
    [t("fee"), fmt(payment.feeXaf) + " XAF"],
    [t("total_paid"), "$" + fmt(payment.usd, 2)],
    [t("reference"), payment.ref],
    [t("date"), when(payment)],
    [t("status"), t("completed")],
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0.2 0.01 64 / 0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" role="dialog" aria-label={t("receipt_success")} style={{ width: "100%", maxWidth: 360, padding: 0, overflow: "hidden", boxShadow: "var(--shadow-pop)", animation: "popIn .22s ease" }}>
        <div style={{ padding: "22px 24px 18px", textAlign: "center", borderBottom: "1px dashed var(--line)" }}>
          <Logo size={22} />
          <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 7, color: "var(--recv)", fontWeight: 700, fontSize: 14 }}>
            <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--recv)", color: "#fff", display: "grid", placeItems: "center", fontSize: 11 }}>✓</span>
            {t("receipt_success")}
          </div>
        </div>
        <div style={{ padding: "8px 24px 4px" }}>
          {rows.map(([k, v], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : "none" }}>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{k}</span>
              <span className={/\d/.test(v) ? "num" : ""} style={{ fontSize: 13, fontWeight: 650, textAlign: "right", whiteSpace: "nowrap", color: k === t("status") ? "var(--recv)" : "var(--ink)" }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "16px 24px", textAlign: "center", borderTop: "1px dashed var(--line)" }}>
          <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 14px" }}>{t("receipt_footer")}</p>
          <button className="btn btn-ghost" onClick={onClose} style={{ width: "100%" }}>{t("close")}</button>
        </div>
      </div>
    </div>
  );
}

export function SuccessStep({ payment, reset }: { payment: Payment; reset: () => void }) {
  const { t } = useI18n();
  const [showReceipt, setShowReceipt] = useState(false);
  return (
    <FlowCard>
      <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
        {/* Momo celebrates the delivery — the payoff moment. */}
        <div style={{ position: "relative", width: 132, height: 116, margin: "0 auto 6px" }}>
          {[
            { left: 6, top: 14, c: "var(--brand)", s: 11, d: ".15s" },
            { left: 108, top: 8, c: "var(--accent)", s: 9, d: ".3s" },
            { left: 118, top: 64, c: "var(--brand)", s: 8, d: ".45s" },
            { left: 0, top: 70, c: "var(--accent)", s: 10, d: ".6s" },
          ].map((sp, i) => (
            <span key={i} aria-hidden="true" style={{ position: "absolute", left: sp.left, top: sp.top, width: sp.s, height: sp.s, borderRadius: "50%", background: sp.c, animation: `sparkle 1.4s ease ${sp.d} infinite` }} />
          ))}
          <Momo size={108} mood="wow" className="momo-celebrate" />
        </div>
        <h2 style={{ fontSize: 25 }}>{t("success_title")}</h2>
        <div className="num" style={{ fontSize: 36, fontWeight: 750, color: "var(--recv)", margin: "12px 0 0", letterSpacing: "-0.02em" }}>{fmt(payment.xaf)} <span style={{ fontSize: 19 }}>XAF</span></div>
        <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 0" }}>{t("delivered_to")} <span style={{ fontWeight: 700, color: "var(--ink)" }}>{payment.recipient.name}</span></p>
      </div>

      <div style={{ marginTop: 22, background: "var(--surface-2)", borderRadius: "var(--r)", padding: "4px 16px", border: "1px solid var(--line)" }}>
        <Row k={t("recipient")} v={payment.recipient.name} />
        <hr className="hair" />
        <Row k={t("mobile_number")} v={fullPhone(payment)} />
        <hr className="hair" />
        <Row k={t("reference")} v={payment.ref} />
        <hr className="hair" />
        <Row k={t("date_time")} v={when(payment)} />
      </div>

      <button className="btn btn-primary" onClick={reset} style={{ width: "100%", marginTop: 18, padding: "16px" }}>{t("make_another")}</button>
      <button className="btn btn-ghost" onClick={() => setShowReceipt(true)} style={{ width: "100%", marginTop: 8 }}>{t("view_receipt")}</button>

      {showReceipt && <Receipt payment={payment} onClose={() => setShowReceipt(false)} />}
    </FlowCard>
  );
}
