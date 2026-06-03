import { useEffect } from "react";
import { Link } from "react-router-dom";
import { DocShell } from "./LegalLayout.js";

export function Contact() {
  useEffect(() => {
    document.title = "Contact & support · MoMo›Me";
  }, []);

  return (
    <DocShell kicker="Support" title="We’re here to help" updated={null} current="contact">
      <p className="lead" style={{ fontSize: 17, color: "var(--ink-2)", marginTop: 18 }}>
        Have a question about a payment, or something not working? Reach us the way that suits you — keep your
        reference (e.g. <span className="mono">MMM-2026-000123</span>) handy and we’ll find it fast.
      </p>

      <div className="contact-grid">
        <a
          className="contact-card"
          href="https://wa.me/237600000000"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat with MoMo›Me support on WhatsApp"
        >
          <div className="ic" aria-hidden="true">💬</div>
          <h3>WhatsApp</h3>
          <p>Fastest for payment questions. Send us your reference and we’ll trace it.</p>
          <span className="val">Chat on WhatsApp <span aria-hidden="true">→</span></span>
        </a>
        <a
          className="contact-card"
          href="mailto:support@momome.app"
          aria-label="Email MoMo›Me support at support@momome.app"
        >
          <div className="ic" aria-hidden="true">✉️</div>
          <h3>Email</h3>
          <p>Best for documents or anything detailed. We reply within one business day.</p>
          <span className="val">support@momome.app <span aria-hidden="true">→</span></span>
        </a>
        <a
          className="contact-card"
          href="tel:+237600000000"
          aria-label="Call MoMo›Me support on +237 6 00 00 00 00"
        >
          <div className="ic" aria-hidden="true">📞</div>
          <h3>Call us</h3>
          <p>Talk to a person during support hours, listed below.</p>
          <span className="val">+237 6 00 00 00 00 <span aria-hidden="true">→</span></span>
        </a>
        <Link className="contact-card" to="/send" aria-label="Open Help and FAQ in the pay flow">
          <div className="ic" aria-hidden="true">❓</div>
          <h3>Help &amp; FAQ</h3>
          <p>Quick answers to the most common questions, right inside the pay flow.</p>
          <span className="val">Open Help <span aria-hidden="true">→</span></span>
        </Link>
      </div>

      <div className="hours">
        <h3>Support hours (WAT)</h3>
        <div className="row"><span>Monday – Friday</span><span>07:00 – 22:00</span></div>
        <div className="row"><span>Saturday</span><span>09:00 – 18:00</span></div>
        <div className="row"><span>Sunday &amp; public holidays</span><span>10:00 – 16:00</span></div>
      </div>

      <p style={{ marginTop: 24, fontSize: 13.5, color: "var(--ink-3)" }}>
        For partner, compliance, or press enquiries, see the <Link to="/admin">partner portal</Link>.
        Read our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </DocShell>
  );
}
