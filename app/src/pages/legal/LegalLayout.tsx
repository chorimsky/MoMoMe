import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo, ThemeToggle } from "../../components/atoms.js";

type Current = "terms" | "privacy" | "contact" | null;

const FOOT_LINKS: Array<[string, string, Current]> = [
  ["/", "Home", null],
  ["/terms", "Terms", "terms"],
  ["/privacy", "Privacy", "privacy"],
  ["/contact", "Contact", "contact"],
  ["/admin", "For partners", null],
];

export function PageTop() {
  return (
    <header className="pg-top">
      <Link className="pg-brand" to="/" aria-label="MoMo›Me — home">
        <Logo size={34} />
      </Link>
      <div className="pg-actions">
        <Link className="pg-link" to="/contact">Help</Link>
        <ThemeToggle size={38} />
        <Link className="btn btn-primary cta-sm" to="/send">Pay Mobile Money</Link>
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
  children,
}: {
  kicker: string;
  title: string;
  updated?: string | null;
  current: Current;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <PageTop />
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
