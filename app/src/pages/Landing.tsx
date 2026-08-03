import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Logo, Momo, ThemeToggle } from "../components/atoms.js";
import { useNarrow } from "../lib/useNarrow.js";
import { useI18n } from "../lib/i18n.js";
import "./Landing.css";

/* Simple line glyphs (rounded, friendly) for benefit + step tiles. */
function G({ n }: { n: string }) {
  const p = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const I: Record<string, ReactNode> = {
    bolt: <path d="M10 1.5 L4 10 H8 L7 16.5 L14 7.5 H9.5 Z" fill="currentColor" stroke="none" />,
    smile: <g><circle cx="9" cy="9" r="6.6" /><path d="M6.2 10.5 Q9 13 11.8 10.5" /><circle cx="6.7" cy="7.4" r="0.5" fill="currentColor" /><circle cx="11.3" cy="7.4" r="0.5" fill="currentColor" /></g>,
    shield: <g><path d="M9 1.6 L15 4 V9 c0 4-2.6 6.4-6 7.6 C5.6 15.4 3 13 3 9 V4 Z" /><path d="M6.3 8.8 L8.2 10.7 L11.8 6.8" /></g>,
    globe: <g><circle cx="9" cy="9" r="6.6" /><path d="M2.4 9 H15.6 M9 2.4 C11 4.5 11 13.5 9 15.6 C7 13.5 7 4.5 9 2.4Z" /></g>,
    tag: <g><path d="M8.6 2.2 H14 a1.8 1.8 0 0 1 1.8 1.8 V9.4 L9.4 15.8 a1.5 1.5 0 0 1-2.1 0 L2.2 10.7 a1.5 1.5 0 0 1 0-2.1 Z" /><circle cx="11.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" /></g>,
    phone: <g><rect x="5" y="2" width="8" height="14" rx="2" /><path d="M8 13.5 H10" /></g>,
    number: <g><path d="M3 6 H15 M3 12 H15 M7 3 L6 15 M12 3 L11 15" /></g>,
    send: <path d="M16 2 L2 8.5 L7.5 10.5 L10 16 Z" fill="currentColor" stroke="none" />,
  };
  return <svg {...p}>{I[n] ?? I.bolt}</svg>;
}

/* Momo-style duotone icons — bold rounded ink outline + warm brand fills, like
   the mascot. Each part is classed so CSS can animate it on hover. Colours are
   theme variables, so they adapt to light/dark. */
function Icon({ n, size = 28 }: { n: string; size?: number }) {
  const ink = "var(--ink)";
  const I: Record<string, ReactNode> = {
    bolt: (
      <path d="M13 2 4.5 13H10l-1 9 10.5-12H13.5z" fill="var(--brand)" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
    ),
    smile: (
      <g>
        <circle cx="12" cy="12" r="9.2" fill="var(--brand)" stroke={ink} strokeWidth="2" />
        <circle cx="6.7" cy="13.4" r="1.5" fill="var(--accent)" opacity="0.5" />
        <circle cx="17.3" cy="13.4" r="1.5" fill="var(--accent)" opacity="0.5" />
        <circle className="eye" cx="9.2" cy="10.6" r="1.15" fill={ink} />
        <circle className="eye" cx="14.8" cy="10.6" r="1.15" fill={ink} />
        <path d="M8.6 14.6Q12 17.7 15.4 14.6" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      </g>
    ),
    shield: (
      <g>
        <path d="M12 2.5 20 5.5V11c0 5-3.4 8.3-8 9.9C7.4 19.3 4 16 4 11V5.5z" fill="var(--recv)" fillOpacity="0.16" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
        <path className="check" d="M8.2 11.6 11 14.4 16 8.9" fill="none" stroke="var(--recv)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ),
    globe: (
      <g>
        <circle cx="12" cy="12" r="9.2" fill="var(--brand)" fillOpacity="0.16" stroke={ink} strokeWidth="2" />
        <g className="merid" fill="none" stroke={ink} strokeWidth="1.7">
          <path d="M2.9 12H21.1" />
          <path d="M12 2.8C15 6 15 18 12 21.2 9 18 9 6 12 2.8z" />
        </g>
      </g>
    ),
    tag: (
      <g>
        <path d="M11.4 3H19a2 2 0 0 1 2 2v7.6L12.5 21a2 2 0 0 1-2.8 0L3 14.3a2 2 0 0 1 0-2.8z" fill="var(--accent)" fillOpacity="0.18" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="16" cy="8" r="1.7" fill="var(--accent)" stroke={ink} strokeWidth="1.4" />
      </g>
    ),
    number: (
      <g>
        <rect x="5" y="2.5" width="14" height="19" rx="3.2" fill="var(--brand)" fillOpacity="0.16" stroke={ink} strokeWidth="2" />
        <rect x="8" y="5.4" width="8" height="4.8" rx="1.3" fill="var(--brand)" stroke={ink} strokeWidth="1.5" />
        <circle cx="9" cy="14.4" r="1" fill={ink} /><circle cx="12" cy="14.4" r="1" fill={ink} /><circle cx="15" cy="14.4" r="1" fill={ink} />
        <circle className="key" cx="12" cy="18" r="1.3" fill="var(--accent)" />
      </g>
    ),
    send: (
      <g>
        <path d="M21 3 3 10.5 9.6 13 12 19.5z" fill="var(--accent)" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
        <path d="M21 3 9.6 13" fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
      </g>
    ),
  };
  return <svg className={`ico ico-${n}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{I[n] ?? I.bolt}</svg>;
}

// Benefit tiles / steps carry i18n KEYS (resolved at render); network chips carry
// brand names (not translated).
const WHY = [
  { icon: "bolt", t: "lp_why_fast_t", d: "lp_why_fast_d" },
  { icon: "smile", t: "lp_why_simple_t", d: "lp_why_simple_d" },
  { icon: "shield", t: "lp_why_trusted_t", d: "lp_why_trusted_d" },
  { icon: "globe", t: "lp_why_available_t", d: "lp_why_available_d" },
  { icon: "tag", t: "lp_why_affordable_t", d: "lp_why_affordable_d" },
];

const NETS = [
  { sym: <G n="bolt" />, t: "Lightning", c: "var(--brand)", ink: "var(--brand-ink)" },
  { sym: "₿", t: "Bitcoin", c: "var(--accent)", ink: "#fff" },
  { sym: "₮", t: "USDT", c: "var(--recv)", ink: "#fff" },
  { sym: <G n="phone" />, t: "MTN & Orange Money", c: "var(--ink)", ink: "var(--paper)" },
];

const STEPS = [
  { ic: "number", n: "01", t: "lp_step1_t", d: "lp_step1_d" },
  { ic: "shield", n: "02", t: "lp_step2_t", d: "lp_step2_d" },
  { ic: "send", n: "03", t: "lp_step3_t", d: "lp_step3_d" },
];

export function Landing() {
  const sm = useNarrow();
  const { t, lang, setLang } = useI18n();
  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div className="lp">
        <header className="lp-top">
          <Link to="/" aria-label="MoMo›Me — home" style={{ textDecoration: "none", display: "inline-flex" }}><Logo size={sm ? 28 : 36} /></Link>
          <div className="lp-actions">
            <a className="lp-link" href="#how">{t("lp_how")}</a>
            <button type="button" className="lp-link" onClick={() => setLang(lang === "en" ? "fr" : "en")}
              aria-label={t("lp_switch_lang")} style={{ cursor: "pointer", border: "none", background: "none", font: "inherit", fontWeight: 700 }}>
              {lang === "en" ? "FR" : "EN"}
            </button>
            <ThemeToggle size={38} />
            <Link className="btn btn-primary cta-sm" to="/send">{t("lp_cta_pay")}<span className="cta-rest"> Mobile Money</span></Link>
          </div>
        </header>

        <section className="hero">
          <div className="hero-text">
            <div className="eyebrow">{t("lp_eyebrow")}</div>
            <h1>{t("lp_h1")}</h1>
            <p className="lede">{t("lp_lede")}</p>
            <div className="cta-row">
              <Link className="btn btn-primary btn-lg" to="/send">{t("lp_cta_send")}</Link>
              <a className="btn btn-ghost btn-lg" href="#how">{t("lp_how")}</a>
            </div>
            <div className="trust">
              <span><span className="tdot" /> {t("lp_trust_1")}</span>
              <span><span className="tdot" /> {t("lp_trust_2")}</span>
              <span><span className="tdot" /> {t("lp_trust_3")}</span>
            </div>
          </div>

          <div className="hero-visual">
            <span className="momo-hint" aria-hidden="true">poke me 👆</span>
            <Momo size={sm ? 112 : 144} className="hero-momo" />
            <div className="hero-card" aria-hidden="true">
              <div className="pc-check">✓</div>
              <div className="pc-title">{t("lp_pc_title")}</div>
              <div className="pc-amt">50 000 <span>XAF</span></div>
              <div className="pc-sub">{t("lp_pc_sub")}</div>
              <div className="pc-rows">
                <div className="r"><span>{t("lp_pc_recipient")}</span><span>NANA JEAN PAUL</span></div>
                <div className="r"><span>{t("lp_pc_reference")}</span><span>MMM-2026-000123</span></div>
                <div className="r"><span>{t("lp_pc_arrival")}</span><span style={{ color: "var(--recv)" }}>{t("lp_pc_instant")}</span></div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="how">
          <div className="sec-head">
            <h2>{t("lp_how")}</h2>
            <Momo size={44} className="sec-momo" />
          </div>
          <p className="how-sub">{t("lp_how_sub")}</p>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <div className="step-ic"><Icon n={s.ic} /></div>
                <div className="n">{s.n}</div>
                <h3>{t(s.t)}</h3>
                <p>{t(s.d)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="why">
          <h2>{t("lp_why_title")}</h2>
          <p className="how-sub">{t("lp_why_sub")}</p>
          <div className="why-grid">
            {WHY.map((b) => (
              <div className="why-card" key={b.t}>
                <div className="why-ic"><Icon n={b.icon} /></div>
                <h3>{t(b.t)}</h3>
                <p>{t(b.d)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="nets">
          <h2>{t("lp_nets_title")}</h2>
          <p className="how-sub">{t("lp_nets_sub")}</p>
          <div className="nets-row">
            {NETS.map((n) => (
              <div className="net-chip" key={n.t}>
                <span className="net-ic" style={{ background: n.c, color: n.ink }}>{n.sym}</span>
                {n.t}
              </div>
            ))}
          </div>
        </section>

        <nav className="lp-foot-links" aria-label="Convert to Mobile Money" style={{ marginBottom: 14, flexWrap: "wrap", justifyContent: "center" }}>
          <a href="/bitcoin-to-mobile-money/">Bitcoin to Mobile Money</a>
          <a href="/lightning-to-mobile-money/">Lightning to Mobile Money</a>
          <a href="/usdt-to-mobile-money/">USDT to Mobile Money</a>
          <a href="/stablecoin-to-mobile-money/">Stablecoin to Mobile Money</a>
          <a href="/crypto-to-mobile-money/">Crypto to Mobile Money</a>
          <a href="/send-money-to-africa/">Send money to Africa</a>
          <a href="/use-cases/">Use cases</a>
          <a href="/learn/">Learn</a>
          <a href="/countries/">Coverage</a>
          <a href="/fr/" lang="fr">Français</a>
        </nav>
        <footer className="lp-foot">
          <span className="c">{t("lp_foot_copy")}</span>
          <nav className="lp-foot-links" aria-label="Footer">
            <Link to="/claim">{t("lp_foot_claim")}</Link>
            <Link to="/contact">{t("lp_foot_help")}</Link>
            <Link to="/terms">{t("lp_foot_terms")}</Link>
            <Link to="/privacy">{t("lp_foot_privacy")}</Link>
            <Link to="/admin">{t("lp_foot_partners")}</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
