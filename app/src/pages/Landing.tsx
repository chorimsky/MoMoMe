import { Link } from "react-router-dom";
import { Logo, Momo } from "../components/atoms.js";
import "./Landing.css";

export function Landing() {
  return (
    <div style={{ background: "var(--paper)", minHeight: "100vh" }}>
      <div className="lp">
        <header className="lp-top">
          <Logo size={26} />
          <div className="lp-actions">
            <a className="lp-link" href="#how">How it works</a>
            <Link className="btn btn-primary cta-sm" to="/send">Pay Mobile Money</Link>
          </div>
        </header>

        <section className="hero">
          <div className="hero-text">
            <div className="eyebrow">⚡ Bitcoin → Mobile Money</div>
            <h1>Spend Bitcoin. Receive Mobile Money.</h1>
            <p className="lede">Convert Bitcoin, Lightning and USDT into MTN &amp; Orange Money — instantly, in seconds.</p>
            <div className="cta-row">
              <Link className="btn btn-primary btn-lg" to="/send">Send Money</Link>
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
            <div className="step">
              <div className="n">01</div>
              <h3>Enter number &amp; amount</h3>
              <p>Add the recipient's MTN or Orange Money number and how much you'd like to pay.</p>
            </div>
            <div className="step">
              <div className="n">02</div>
              <h3>Confirm &amp; pay</h3>
              <p>We check the recipient's name and show exactly what arrives — then you confirm.</p>
            </div>
            <div className="step">
              <div className="n">03</div>
              <h3>Money arrives</h3>
              <p>The recipient is credited on their Mobile Money account in seconds, with a receipt to match.</p>
            </div>
          </div>
        </section>

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
