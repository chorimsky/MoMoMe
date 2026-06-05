import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Logo, Momo, ThemeToggle } from "../components/atoms.js";
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

const WHY = [
  { icon: "bolt", t: "Fast", d: "Delivered in seconds, not days." },
  { icon: "smile", t: "Simple", d: "Just a number and an amount." },
  { icon: "shield", t: "Trusted", d: "Name-checked before every payment." },
  { icon: "globe", t: "Available", d: "Send from anywhere, anytime." },
  { icon: "tag", t: "Affordable", d: "One small upfront fee. No surprises." },
];

const NETS = [
  { sym: <G n="bolt" />, t: "Lightning", c: "var(--brand)", ink: "var(--brand-ink)" },
  { sym: "₿", t: "Bitcoin", c: "var(--accent)", ink: "#fff" },
  { sym: "₮", t: "USDT", c: "var(--recv)", ink: "#fff" },
  { sym: <G n="phone" />, t: "MTN & Orange Money", c: "var(--ink)", ink: "var(--paper)" },
];

const STEPS = [
  { ic: "number", n: "01", t: "Enter number & amount", d: "Add the recipient's MTN or Orange Money number and how much you'd like to pay." },
  { ic: "shield", n: "02", t: "Confirm & pay", d: "We check the recipient's name and show exactly what arrives — then you confirm." },
  { ic: "send", n: "03", t: "Money arrives", d: "The recipient is credited on their Mobile Money account in seconds, with a receipt to match." },
];

export function Landing() {
  return (
    <div style={{ background: "var(--paper)", minHeight: "100vh" }}>
      <div className="lp">
        <header className="lp-top">
          <Logo size={36} />
          <div className="lp-actions">
            <a className="lp-link" href="#how">How it works</a>
            <ThemeToggle size={38} />
            <Link className="btn btn-primary cta-sm" to="/send">Pay Mobile Money</Link>
          </div>
        </header>

        <section className="hero">
          <div className="hero-text">
            <div className="eyebrow">⚡ Instant Mobile Money</div>
            <h1>Send money to any Mobile Money number.</h1>
            <p className="lede">Pay MTN &amp; Orange Money accounts directly — delivered in seconds, from anywhere in the world.</p>
            <div className="cta-row">
              <Link className="btn btn-primary btn-lg" to="/send">Send Mobile Money</Link>
              <a className="btn btn-ghost btn-lg" href="#how">How it works</a>
            </div>
            <div className="trust">
              <span><span className="tdot" /> Delivered in seconds</span>
              <span><span className="tdot" /> MTN &amp; Orange Money</span>
              <span><span className="tdot" /> Secure &amp; private</span>
            </div>
          </div>

          <div className="hero-visual">
            <Momo size={132} className="hero-momo" />
            <div className="hero-card" aria-hidden="true">
              <div className="pc-check">✓</div>
              <div className="pc-title">Payment delivered</div>
              <div className="pc-amt">50,000 <span>XAF</span></div>
              <div className="pc-sub">delivered to MTN Mobile Money</div>
              <div className="pc-rows">
                <div className="r"><span>Recipient</span><span>NANA JEAN PAUL</span></div>
                <div className="r"><span>Reference</span><span>MMM-2026-000123</span></div>
                <div className="r"><span>Arrival</span><span style={{ color: "var(--recv)" }}>Instant</span></div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="how">
          <h2>How it works</h2>
          <p className="how-sub">Three simple steps. No account to manage, no waiting.</p>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <div className="step-ic"><G n={s.ic} /></div>
                <div className="n">{s.n}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="why">
          <h2>Why MomoMe</h2>
          <p className="how-sub">Built for speed, clarity and trust.</p>
          <div className="why-grid">
            {WHY.map((b) => (
              <div className="why-card" key={b.t}>
                <div className="why-ic"><G n={b.icon} /></div>
                <h3>{b.t}</h3>
                <p>{b.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="nets">
          <h2>Pay however suits you</h2>
          <p className="how-sub">Fund your payment with Bitcoin, Lightning or USDT — your recipient only ever receives Mobile Money.</p>
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
          <a href="/learn/">Learn</a>
          <a href="/countries/">Coverage</a>
        </nav>
        <footer className="lp-foot">
          <span className="c">© 2026 MoMo›Me · Secure Mobile Money payments</span>
          <nav className="lp-foot-links" aria-label="Footer">
            <Link to="/claim">Claim your account</Link>
            <Link to="/contact">Help</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/admin">For partners →</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
