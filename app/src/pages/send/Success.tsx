import { useState, type CSSProperties } from "react";
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
  // Mobile-Money-only itemisation — never expose USD/crypto to the customer.
  const rows: Array<[string, string]> = [
    [t("recipient"), payment.recipient.name || "—"],
    [t("mobile_number"), fullPhone(payment)],
    [t("amount_delivered"), fmt(payment.xaf) + " XAF"],
    [t("fee"), fmt(payment.feeXaf) + " XAF"],
    [t("total_paid"), fmt(payment.xaf + payment.feeXaf) + " XAF"],
    [t("reference"), payment.ref],
    [t("date"), when(payment)],
  ];
  // Notch that punches the "ticket" perforation — coloured to match the scrim.
  const notch = (side: "left" | "right"): CSSProperties => ({
    position: "absolute", top: -9, width: 18, height: 18, borderRadius: "50%",
    background: "oklch(0.2 0.01 64 / 0.45)",
    ...(side === "left" ? { left: -9 } : { right: -9 }),
  });
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0.2 0.01 64 / 0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50, backdropFilter: "blur(2px)" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" role="dialog" aria-label={t("receipt_success")} style={{ width: "100%", maxWidth: 348, padding: 0, overflow: "hidden", boxShadow: "var(--shadow-pop)", animation: "popIn .22s ease" }}>
        {/* header — branded band + success badge + the delivered amount */}
        <div style={{ background: "var(--brand-wash)", padding: "20px 24px 22px", textAlign: "center" }}>
          <Logo size={21} />
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--recv)", color: "#fff", display: "grid", placeItems: "center", margin: "16px auto 0", fontSize: 25, fontWeight: 800, boxShadow: "0 8px 22px oklch(0.6 0.1 158 / 0.35)" }}>✓</div>
          <div style={{ marginTop: 12, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16.5 }}>{t("receipt_success")}</div>
          <div className="num" style={{ fontSize: 30, fontWeight: 750, color: "var(--ink)", marginTop: 8, letterSpacing: "-0.02em" }}>{fmt(payment.xaf)} <span style={{ fontSize: 15, color: "var(--ink-3)" }}>XAF</span></div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3 }}>{t("delivered_to")} <span style={{ fontWeight: 700, color: "var(--ink)" }}>{payment.recipient.name}</span></div>
        </div>

        {/* perforated tear line */}
        <div style={{ position: "relative", height: 0, borderTop: "2px dashed var(--line)" }}>
          <span aria-hidden="true" style={notch("left")} />
          <span aria-hidden="true" style={notch("right")} />
        </div>

        {/* itemised rows */}
        <div style={{ padding: "12px 24px 6px", background: "var(--surface)" }}>
          {rows.map(([k, v], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : "none" }}>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{k}</span>
              <span className={/\d/.test(v) ? "num" : ""} style={{ fontSize: 13, fontWeight: 650, textAlign: "right", whiteSpace: "nowrap", color: "var(--ink)" }}>{v}</span>
            </div>
          ))}
          {/* status as a friendly green pill */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0 6px" }}>
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("status")}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--recv)", background: "var(--recv-wash)", padding: "4px 11px", borderRadius: 999 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--recv)" }} />{t("completed")}
            </span>
          </div>
        </div>

        <div style={{ padding: "8px 24px 18px", textAlign: "center" }}>
          <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "0 0 13px", lineHeight: 1.5 }}>{t("receipt_footer")}</p>
          <button className="btn btn-primary" onClick={onClose} style={{ width: "100%" }}>{t("close")}</button>
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
