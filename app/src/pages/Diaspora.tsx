/* ============================================================
   /diaspora — the France→Cameroon corridor landing (Growth Engine §1/§3). A
   FR-first surface for the diaspora "pay a shop / rent / family back home" unit,
   funnelling to the directory (pay a business) and the send flow (pay a number).
   ============================================================ */
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { useI18n } from "../lib/i18n.js";

const cardStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: "18px 20px" };

function UseCase({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--brand-wash)", color: "var(--brand-ink)", marginBottom: 12 }}>{icon}</div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16 }}>{title}</div>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>{desc}</p>
    </div>
  );
}

const g = (d: ReactNode) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;

export function Diaspora() {
  const { t } = useI18n();
  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 40px" }}>
        <SiteHeader />

        <section style={{ padding: "8px 0 8px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "var(--brand-ink)", background: "var(--brand-wash)", border: "1.5px solid var(--brand)", padding: "6px 14px", borderRadius: 999 }}>🌍 {t("dia_eyebrow")}</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(30px,6vw,48px)", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 18, textWrap: "balance" }}>{t("dia_h1")}</h1>
          <p style={{ color: "var(--ink-2)", fontSize: 16, marginTop: 14, lineHeight: 1.6, maxWidth: "58ch" }}>{t("dia_lede")}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
            <Link to="/discover" className="btn btn-primary" style={{ textDecoration: "none", padding: "14px 22px" }}>{t("dia_cta_business")}</Link>
            <Link to="/send" className="btn btn-ghost" style={{ textDecoration: "none", padding: "14px 22px" }}>{t("dia_cta_send")}</Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 12.5, color: "var(--ink-3)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--recv)" }} />{t("dia_trust")}
          </div>
        </section>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20 }}>{t("dia_uc_title")}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 14 }}>
            <UseCase icon={g(<><path d="M3 9h18M6 9V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M4 9l1 11h14l1-11" /></>)} title={t("dia_uc1_t")} desc={t("dia_uc1_d")} />
            <UseCase icon={g(<><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-6h6v6" /></>)} title={t("dia_uc2_t")} desc={t("dia_uc2_d")} />
            <UseCase icon={g(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 5.8M18 20a5.5 5.5 0 0 0-3-4.9" /></>)} title={t("dia_uc3_t")} desc={t("dia_uc3_d")} />
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
