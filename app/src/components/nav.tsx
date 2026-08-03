/* ============================================================
   Shared site navigation — ONE header + ONE footer for every
   customer-facing page (Landing, Send, Claim, Terms, Privacy,
   Contact, 404). Before this, the header was hand-built 3–4× and
   the footer twice, and /send + /claim were navigation "islands"
   with no path to legal/support. Rendering SiteHeader + SiteFooter
   on every customer route guarantees: logo → home from anywhere,
   FR/EN + theme everywhere, and no dead ends.
   ============================================================ */
import { Link } from "react-router-dom";
import { Logo, ThemeToggle } from "./atoms.js";
import { useI18n } from "../lib/i18n.js";
import { useNarrow } from "../lib/useNarrow.js";

/** Compact FR/EN pill — the single shared language switch. */
export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      type="button"
      className="tap"
      onClick={() => setLang(lang === "en" ? "fr" : "en")}
      aria-label={lang === "en" ? "Passer en français" : "Switch to English"}
      style={{ cursor: "pointer", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)", fontWeight: 700, fontSize: 12.5, padding: "8px 12px", borderRadius: "var(--r-pill)", fontFamily: "inherit", minHeight: 40 }}
    >
      {lang === "en" ? "FR" : "EN"}
    </button>
  );
}

/**
 * Shared header: logo→home · FR/EN · theme · (optional) Pay CTA.
 * `cta={false}` on /send itself (where the whole page IS the pay flow).
 */
export function SiteHeader({ cta = true }: { cta?: boolean }) {
  const { t } = useI18n();
  const sm = useNarrow();
  return (
    <header className="site-header">
      <Link to="/" aria-label="MoMo›Me — home" style={{ textDecoration: "none", display: "inline-flex" }}>
        <Logo size={sm ? 27 : 34} />
      </Link>
      <div className="site-actions">
        <LangToggle />
        <ThemeToggle size={sm ? 34 : 38} />
        {cta && (
          <Link className="btn btn-primary cta-sm" to="/send">
            {t("lp_cta_pay")}<span className="cta-rest"> Mobile Money</span>
          </Link>
        )}
      </div>
    </header>
  );
}

type FootKey = "send" | "claim" | "contact" | "terms" | "privacy" | null;

const FOOT_LINKS: Array<[to: string, key: string, current: FootKey]> = [
  ["/", "nav_home", null],
  ["/send", "lp_cta_pay", "send"],
  ["/claim", "lp_foot_claim", "claim"],
  ["/contact", "lp_foot_help", "contact"],
  ["/terms", "lp_foot_terms", "terms"],
  ["/privacy", "lp_foot_privacy", "privacy"],
];

/**
 * Shared footer: Home · Pay · Claim · Help · Terms · Privacy (+ discreet
 * "For partners"). `current` sets aria-current on the active page. Rendering
 * this on every customer page is what kills the /send + /claim islands.
 */
export function SiteFooter({ current = null }: { current?: FootKey }) {
  const { t } = useI18n();
  return (
    <footer className="site-foot">
      <nav className="site-foot-links" aria-label={t("nav_home")}>
        {FOOT_LINKS.map(([to, key, cur]) => (
          <Link key={to} to={to} aria-current={cur !== null && cur === current ? "page" : undefined}>
            {t(key)}
          </Link>
        ))}
      </nav>
      <span className="c">{t("lp_foot_copy")}</span>
      <Link to="/admin" className="site-foot-partners">{t("lp_foot_partners")}</Link>
    </footer>
  );
}
