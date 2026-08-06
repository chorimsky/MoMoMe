/* ============================================================
   /ambassador — the growth-loop dashboard. Your referral code + shareable link/QR,
   your status tier, and the merchants you've brought (and whether they're taking
   payments — the metric that advances you). Reuses the device-account identity;
   no separate login. See docs/growth-engine.md §4.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AmbassadorSummary, AmbassadorTier } from "@shared/types.js";
import { SiteHeader } from "../components/nav.js";
import { Spinner, QR } from "../components/atoms.js";
import { useI18n } from "../lib/i18n.js";
import { api } from "../api/client.js";

const cardStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: "clamp(16px, 3.6vw, 20px)" };

const TIER_META: Record<AmbassadorTier, { labelKey: string; next?: AmbassadorTier; at: number }> = {
  rep: { labelKey: "amb_tier_rep", next: "city_lead", at: 3 },
  city_lead: { labelKey: "amb_tier_city", next: "regional_lead", at: 10 },
  regional_lead: { labelKey: "amb_tier_regional", at: 10 },
};

export function Ambassador() {
  const { t } = useI18n();
  const [sum, setSum] = useState<AmbassadorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const origin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);

  useEffect(() => {
    let alive = true;
    api.getReferral().then((s) => { if (alive) setSum(s); }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const link = sum ? `${origin}/?ref=${sum.code}` : "";
  const copy = () => { if (link) void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); };

  const tier = sum ? TIER_META[sum.tier] : TIER_META.rep;

  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 56px" }}>
        <SiteHeader />

        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: "clamp(26px,5vw,34px)", letterSpacing: "-0.02em" }}>{t("amb_title")}</h1>
          <p style={{ color: "var(--ink-2)", fontSize: 15, marginTop: 8, lineHeight: 1.6, maxWidth: "54ch" }}>{t("amb_sub")}</p>
        </div>

        {loading && <div style={{ display: "grid", placeItems: "center", minHeight: "30vh" }}><Spinner size={24} /></div>}

        {!loading && sum && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* referral code + share */}
            <div style={{ ...cardStyle, background: "var(--brand-wash)", border: "1px solid color-mix(in oklab, var(--brand) 30%, var(--line))" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)" }}>{t("amb_your_code")}</div>
              <div className="num" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "0.08em", color: "var(--ink)", marginTop: 4 }}>{sum.code}</div>
              <div className="num" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 8, wordBreak: "break-all" }}>{link}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={copy}>{copied ? t("amb_copied") : t("amb_copy_link")}</button>
                <button className="btn btn-ghost" onClick={() => setShowQr((v) => !v)}>{showQr ? t("amb_hide_qr") : t("amb_show_qr")}</button>
              </div>
              {showQr && (
                <div style={{ display: "grid", placeItems: "center", padding: "16px 0 4px" }}>
                  <div style={{ background: "#fff", padding: 12, borderRadius: 14 }}><QR value={link} size={180} /></div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 8 }}>{t("amb_scan_join")}</div>
                </div>
              )}
            </div>

            {/* status + stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <div style={{ ...cardStyle, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>{t("amb_status")}</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 15, fontWeight: 750, color: "var(--accent)", background: "var(--accent-wash)", padding: "5px 12px", borderRadius: 999 }}>★ {t(tier.labelKey)}</div>
                {tier.next && (() => { const remain = Math.max(0, tier.at - sum.activeMerchants); return <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>{remain} {remain === 1 ? t("amb_more_active_one") : t("amb_more_active")} {t(TIER_META[tier.next].labelKey)}</div>; })()}
              </div>
              <div style={{ ...cardStyle, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>{t("amb_brought")}</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 750, marginTop: 6 }}>{sum.merchants.length}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{sum.activeMerchants} {t("amb_taking")}</div>
              </div>
              <div style={{ ...cardStyle, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>{t("amb_total")}</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 750, marginTop: 6 }}>{sum.referredCount}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{t("amb_devices")}</div>
              </div>
            </div>

            {/* referred merchants */}
            <div style={{ ...cardStyle, padding: 0 }}>
              <div style={{ padding: "16px 18px 8px", fontSize: 13, fontWeight: 700 }}>{t("amb_your_merchants")}</div>
              {sum.merchants.length === 0 && (
                <div style={{ padding: "8px 18px 18px", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>{t("amb_none")}</div>
              )}
              {sum.merchants.map((m) => (
                <div key={m.code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--line-2)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.businessName}</div>
                    <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{m.code}</div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: m.firstPayment ? "var(--recv)" : m.status === "active" ? "var(--warn-ink)" : "var(--ink-3)" }}>
                    {m.firstPayment ? t("amb_st_taking") : m.status === "active" ? t("amb_st_active") : t("amb_st_pending")}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("amb_run_business")} <Link to="/merchant" style={{ color: "var(--accent)", fontWeight: 600 }}>{t("amb_open_merchant")}</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
