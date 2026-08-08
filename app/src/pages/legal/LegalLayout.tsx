import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo, ThemeToggle } from "../../components/atoms.js";
import { useI18n } from "../../lib/i18n.js";
import { useNarrow } from "../../lib/useNarrow.js";

type Current = "terms" | "privacy" | "contact" | null;

/** Compact EN/FR pill — shown only on translated pages (e.g. Contact). */
function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "fr" : "en")}
      aria-label={lang === "en" ? "Passer en français" : "Switch to English"}
      className="pg-lang"
      style={{ cursor: "pointer", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)", fontWeight: 700, fontSize: 12.5, padding: "8px 12px", borderRadius: 999, fontFamily: "inherit" }}
    >
      {lang === "en" ? "FR" : "EN"}
    </button>
  );
}

// [href, i18n key, current] — labels routed through t() so the legal pages
// translate like the rest of the app (previously hardcoded English).
const FOOT_LINKS: Array<[string, string, Current]> = [
  ["/", "nav_home", null],
  ["/terms", "lp_foot_terms", "terms"],
  ["/privacy", "lp_foot_privacy", "privacy"],
  ["/contact", "lp_foot_contact", "contact"],
  ["/admin", "lp_foot_partners", null],
];

export function PageTop({ langToggle = false }: { langToggle?: boolean }) {
  const { t } = useI18n();
  const sm = useNarrow();
  const xs = useNarrow(400);
  return (
    <header className="pg-top">
      <Link className="pg-brand" to="/" aria-label="MoMo›Me — home">
        <Logo size={xs ? 22 : sm ? 26 : 34} />
      </Link>
      <div className="pg-actions">
        <Link className="pg-link" to="/contact">{t("lp_foot_help")}</Link>
        {langToggle && <LangToggle />}
        <ThemeToggle size={xs ? 32 : 38} />
        <Link className="btn btn-primary cta-sm" to="/send">{t("lp_cta_pay")}<span className="cta-rest"> Mobile Money</span></Link>
      </div>
    </header>
  );
}

/** Corporate/software provider disclosure — shown on every legal/content page. */
export function DisclosureNote() {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 32, padding: "16px 18px", borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px solid var(--line)", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
      {t("disclosure_short")}
    </div>
  );
}

export function PageFoot({ current }: { current: Current }) {
  const { t } = useI18n();
  return (
    <footer className="pg-foot">
      <span className="c">© 2026 MoMo›Me · Secure Mobile Money payments</span>
      <span className="c" style={{ flexBasis: "100%", maxWidth: "64ch", lineHeight: 1.5, order: 3 }}>{t("disclosure_legal")}</span>
      <nav className="pg-foot-links" aria-label="Footer">
        {FOOT_LINKS.map(([href, labelKey, key]) => (
          <Link
            key={href}
            to={href}
            aria-current={key !== null && key === current ? "page" : undefined}
          >
            {t(labelKey)}
          </Link>
        ))}
      </nav>
    </footer>
  );
}

export function DocShell({
  kicker,
  title,
  updated,
  current,
  langToggle = false,
  children,
}: {
  kicker: string;
  title: string;
  updated?: string | null;
  current: Current;
  langToggle?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <PageTop langToggle={langToggle} />
      <article>
        <header className="doc-head">
          <div className="eyebrow">{kicker}</div>
          <h1>{title}</h1>
          {updated && (
            <div className="doc-meta">
              Last updated {updated} ·{" "}
              <Link to="/contact">
                Questions? Talk to us <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </header>
        <div className="prose">{children}</div>
        <DisclosureNote />
      </article>
      <PageFoot current={current} />
    </div>
  );
}

export function Sec({
  n,
  title,
  id,
  children,
}: {
  n: string;
  title: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <>
      <h2 id={id}>
        <span className="s">{n}</span>
        {title}
      </h2>
      {children}
    </>
  );
}

export function Summary({ children }: { children: ReactNode }) {
  return (
    <div className="summary">
      <div className="lbl">In plain language</div>
      <p>{children}</p>
    </div>
  );
}
