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
import { api } from "../api/client.js";

const cardStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: "clamp(16px, 3.6vw, 20px)" };

const TIER_META: Record<AmbassadorTier, { label: string; next?: AmbassadorTier; at: number }> = {
  rep: { label: "Rep", next: "city_lead", at: 3 },
  city_lead: { label: "City Lead", next: "regional_lead", at: 10 },
  regional_lead: { label: "Regional Lead", at: 10 },
};

export function Ambassador() {
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
          <h1 style={{ fontSize: "clamp(26px,5vw,34px)", letterSpacing: "-0.02em" }}>Ambassador program</h1>
          <p style={{ color: "var(--ink-2)", fontSize: 15, marginTop: 8, lineHeight: 1.6, maxWidth: "54ch" }}>
            Bring shops and services onto MoMo›Me. You climb from Rep → City Lead → Regional Lead as the
            merchants you sign up start taking real payments.
          </p>
        </div>

        {loading && <div style={{ display: "grid", placeItems: "center", minHeight: "30vh" }}><Spinner size={24} /></div>}

        {!loading && sum && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* referral code + share */}
            <div style={{ ...cardStyle, background: "var(--brand-wash)", border: "1px solid color-mix(in oklab, var(--brand) 30%, var(--line))" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 750, color: "var(--ink-3)" }}>Your referral code</div>
              <div className="num" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "0.08em", color: "var(--ink)", marginTop: 4 }}>{sum.code}</div>
              <div className="num" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 8, wordBreak: "break-all" }}>{link}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
                <button className="btn btn-ghost" onClick={() => setShowQr((v) => !v)}>{showQr ? "Hide QR" : "Show QR"}</button>
              </div>
              {showQr && (
                <div style={{ display: "grid", placeItems: "center", padding: "16px 0 4px" }}>
                  <div style={{ background: "#fff", padding: 12, borderRadius: 14 }}><QR value={link} size={180} /></div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 8 }}>Scan to join MoMo›Me with your code</div>
                </div>
              )}
            </div>

            {/* status + stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <div style={{ ...cardStyle, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>Status</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 15, fontWeight: 750, color: "var(--accent)", background: "var(--accent-wash)", padding: "5px 12px", borderRadius: 999 }}>★ {tier.label}</div>
                {tier.next && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>{Math.max(0, tier.at - sum.activeMerchants)} more active merchant{tier.at - sum.activeMerchants === 1 ? "" : "s"} → {TIER_META[tier.next].label}</div>}
              </div>
              <div style={{ ...cardStyle, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>Merchants brought</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 750, marginTop: 6 }}>{sum.merchants.length}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{sum.activeMerchants} taking payments</div>
              </div>
              <div style={{ ...cardStyle, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)" }}>Total referred</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 750, marginTop: 6 }}>{sum.referredCount}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>devices joined</div>
              </div>
            </div>

            {/* referred merchants */}
            <div style={{ ...cardStyle, padding: 0 }}>
              <div style={{ padding: "16px 18px 8px", fontSize: 13, fontWeight: 700 }}>Merchants you've signed up</div>
              {sum.merchants.length === 0 && (
                <div style={{ padding: "8px 18px 18px", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  None yet. Share your link with shops, cafés and freelancers — when they onboard with your code and take
                  their first payment, they appear here and move you up a tier.
                </div>
              )}
              {sum.merchants.map((m) => (
                <div key={m.code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--line-2)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.businessName}</div>
                    <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{m.code}</div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: m.firstPayment ? "var(--recv)" : m.status === "active" ? "var(--warn-ink)" : "var(--ink-3)" }}>
                    {m.firstPayment ? "Taking payments ✓" : m.status === "active" ? "Active · no sale yet" : "Pending"}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              Run a business too? <Link to="/merchant" style={{ color: "var(--accent)", fontWeight: 600 }}>Open your merchant dashboard →</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
