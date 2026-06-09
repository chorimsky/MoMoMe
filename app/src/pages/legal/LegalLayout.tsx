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

const FOOT_LINKS: Array<[string, string, Current]> = [
  ["/", "Home", null],
  ["/terms", "Terms", "terms"],
  ["/privacy", "Privacy", "privacy"],
  ["/contact", "Contact", "contact"],
  ["/admin", "For partners", null],
];

export function PageTop({ langToggle = false }: { langToggle?: boolean }) {
  const sm = useNarrow();
  const xs = useNarrow(400);
  return (
    <header className="pg-top">
      <Link className="pg-brand" to="/" aria-label="MoMo›Me — home">
        <Logo size={xs ? 22 : sm ? 26 : 34} />
      </Link>
      <div className="pg-actions">
        <Link className="pg-link" to="/contact">Help</Link>
        {langToggle && <LangToggle />}
        <ThemeToggle size={xs ? 32 : 38} />
        <Link className="btn btn-primary cta-sm" to="/send">Pay<span className="cta-rest"> Mobile Money</span></Link>
      </div>
    </header>
  );
}

export function PageFoot({ current }: { current: Current }) {
  return (
    <footer className="pg-foot">
      <span className="c">© 2026 MoMo›Me · Secure Mobile Money payments</span>
      <nav className="pg-foot-links" aria-label="Footer">
        {FOOT_LINKS.map(([href, label, key]) => (
          <Link
            key={href}
            to={href}
            aria-current={key !== null && key === current ? "page" : undefined}
          >
            {label}
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
