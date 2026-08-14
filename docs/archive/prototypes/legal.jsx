/* ============================================================
   MoMo›Me — content pages (legal · support · 404)
   One shell + four doc bodies, routed by window.MMPAGE.
   Reuses <Logo> + tokens from components.jsx / momome.css.
   ============================================================ */

/* ---------- shared chrome ---------- */
function PageTop() {
  return (
    <header className="pg-top">
      <a className="pg-brand" href="index.html" aria-label="MoMo›Me — home"><Logo size={26} /></a>
      <div className="pg-actions">
        <a className="pg-link" href="MoMoMe Contact.html">Help</a>
        <a className="btn btn-primary cta-sm" href="MoMoMe Send Flow.html">Pay Mobile Money</a>
      </div>
    </header>
  );
}

const FOOT_LINKS = [
  ["index.html", "Home", null],
  ["MoMoMe Terms.html", "Terms", "terms"],
  ["MoMoMe Privacy.html", "Privacy", "privacy"],
  ["MoMoMe Contact.html", "Contact", "contact"],
  ["MoMoMe Admin.html", "For partners", null],
];
function PageFoot({ current }) {
  return (
    <footer className="pg-foot">
      <span className="c">© 2026 MoMo›Me · Secure Mobile Money payments</span>
      <nav className="pg-foot-links" aria-label="Footer">
        {FOOT_LINKS.map(([href, label, key]) => (
          <a key={href} href={href} {...(key && key === current ? { "aria-current": "page" } : {})}>{label}</a>
        ))}
      </nav>
    </footer>
  );
}

/* ---------- document scaffolding ---------- */
function DocShell({ kicker, title, updated, current, children }) {
  return (
    <div className="page">
      <PageTop />
      <article>
        <header className="doc-head">
          <div className="eyebrow">{kicker}</div>
          <h1>{title}</h1>
          {updated && (
            <div className="doc-meta">
              Last updated {updated} · <a href="MoMoMe Contact.html">Questions? Talk to us →</a>
            </div>
          )}
        </header>
        <div className="prose">{children}</div>
      </article>
      <PageFoot current={current} />
    </div>
  );
}

function Sec({ n, title, id, children }) {
  return (
    <React.Fragment>
      <h2 id={id}><span className="s">{n}</span>{title}</h2>
      {children}
    </React.Fragment>
  );
}

function Summary({ children }) {
  return (
    <div className="summary">
      <div className="lbl">In plain language</div>
      <p>{children}</p>
    </div>
  );
}

/* ============================================================
   TERMS OF SERVICE
   ============================================================ */
function TermsDoc() {
  return (
    <DocShell kicker="Legal" title="Terms of Service" updated="1 June 2026" current="terms">
      <Summary>
        MoMo›Me lets you send money to MTN Mobile Money and Orange Money accounts. You tell us where it
        should go and how much; we show you the exact amount that will arrive before you confirm. Payments
        are final once delivered, so please double-check the number and name first.
      </Summary>

      <Sec n="01" title="Who we are">
        <p>
          MoMo›Me (“<strong>MoMo›Me</strong>”, “we”, “us”) operates a payment service that delivers funds to
          mobile-money accounts in the Central African franc zone — currently <strong>Cameroon, Gabon,
          Chad, Congo</strong> and the <strong>Central African Republic</strong>. These Terms govern your use
          of our website and payment flow. By initiating a payment, you agree to them.
        </p>
      </Sec>

      <Sec n="02" title="The service">
        <p>
          You can pay an MTN Mobile Money or Orange Money account without creating an account with us. For
          each payment you provide the recipient’s mobile-money number and the amount. Before you confirm, we
          show you:
        </p>
        <ul>
          <li>the recipient name returned by the mobile-money operator,</li>
          <li>the exact amount that will land in the recipient’s wallet, in <span className="mono">XAF</span>, and</li>
          <li>any fee, shown separately and never hidden inside the rate.</li>
        </ul>
        <p>
          We act as an intermediary that instructs the operator to credit the recipient. We do not hold a
          stored balance on your behalf.
        </p>
      </Sec>

      <Sec n="03" title="Confirming a payment">
        <p>
          A payment is authorised when you complete the confirmation step. Each payment is assigned a
          reference such as <span className="mono">MMM-2026-000123</span>. Keep this reference — it is how we
          and the operator identify the transaction if you need support.
        </p>
        <p>
          You are responsible for entering the correct number. We surface the recipient name we receive so you
          can catch mistakes, but we cannot recover funds delivered to a number you entered incorrectly.
        </p>
      </Sec>

      <Sec n="04" title="Finality &amp; refunds">
        <p>
          Mobile-money credits are <strong>final once delivered</strong> and generally cannot be reversed. If a
          payment <em>fails to deliver</em>, we return the amount you paid using the original method, less any
          third-party network fees that were unavoidably incurred. If you believe a payment was delivered in
          error, contact us with your reference within <strong>30 days</strong> and we will investigate with the
          operator, though we cannot guarantee recovery.
        </p>
      </Sec>

      <Sec n="05" title="Fees &amp; exchange rates">
        <p>
          Any fee and the exchange rate applied are displayed before you confirm and again on your receipt.
          Rates move with the market; the rate you confirm is the rate we honour for that payment.
        </p>
      </Sec>

      <Sec n="06" title="Acceptable use">
        <p>You agree not to use MoMo›Me to:</p>
        <ul>
          <li>send funds connected to fraud, money laundering, or the financing of terrorism;</li>
          <li>evade sanctions or send to sanctioned persons or jurisdictions;</li>
          <li>break the law of the country you are paying from or paying into.</li>
        </ul>
        <p>
          We may decline, hold, or unwind a payment, and request identity information, where we are required to
          by law or where we reasonably suspect misuse.
        </p>
      </Sec>

      <Sec n="07" title="Availability">
        <p>
          We aim for the service to be available around the clock, but delivery depends on the mobile-money
          operators and payment networks we connect to. Outages on their side can delay a payment. When a
          delay occurs, your funds are never lost — a payment either completes or is returned.
        </p>
      </Sec>

      <Sec n="08" title="Liability">
        <p>
          To the extent permitted by law, our liability for any payment is limited to the amount of that
          payment plus any fee you paid us for it. We are not liable for losses caused by incorrect details you
          provided or by operator outages outside our control.
        </p>
      </Sec>

      <Sec n="09" title="Changes to these terms">
        <p>
          We may update these Terms. The “last updated” date above reflects the current version; the version in
          force for a payment is the one shown when you confirmed it.
        </p>
      </Sec>

      <Sec n="10" title="Contact">
        <p>
          Questions about these Terms? Reach us via the <a href="MoMoMe Contact.html">contact page</a>. See also
          our <a href="MoMoMe Privacy.html">Privacy Policy</a>.
        </p>
      </Sec>
    </DocShell>
  );
}

/* ============================================================
   PRIVACY POLICY
   ============================================================ */
function PrivacyDoc() {
  return (
    <DocShell kicker="Legal" title="Privacy Policy" updated="1 June 2026" current="privacy">
      <Summary>
        We collect only what we need to move your money and meet our legal duties: who is paying, who is being
        paid, and how much. We don’t sell your data, and we don’t ask you to open an account to send a payment.
      </Summary>

      <Sec n="01" title="What we collect">
        <ul>
          <li><strong>Payment details</strong> — recipient mobile-money number, amount, the name the operator returns, and the reference.</li>
          <li><strong>Sender details</strong> — the funding method you use and, where the law requires it, identity information to verify a payment.</li>
          <li><strong>Technical data</strong> — device and browser information and approximate location, used to keep the service secure and to prevent fraud.</li>
        </ul>
      </Sec>

      <Sec n="02" title="Why we use it">
        <ul>
          <li>to deliver your payment to the right mobile-money account;</li>
          <li>to show you a receipt and answer support questions tied to your reference;</li>
          <li>to detect and prevent fraud, and to meet anti-money-laundering and sanctions obligations;</li>
          <li>to keep records the law requires us to keep.</li>
        </ul>
      </Sec>

      <Sec n="03" title="Who we share it with">
        <p>
          We share the minimum necessary with the parties that make a payment work: the <strong>mobile-money
          operators</strong> (MTN, Orange) that credit the recipient, the <strong>payment and settlement
          partners</strong> that route funds, and regulators or law enforcement where we are legally required
          to. We do <strong>not</strong> sell your personal data or share it for advertising.
        </p>
      </Sec>

      <Sec n="04" title="How long we keep it">
        <p>
          We keep transaction records for as long as financial-services law requires — typically several years
          after a payment — and then delete or anonymise them. Security and fraud logs are kept for a shorter
          period.
        </p>
      </Sec>

      <Sec n="05" title="Your rights">
        <p>
          Subject to local law, you can ask us for a copy of the personal data we hold about you, ask us to
          correct it, or ask us to delete it where we are not required to keep it. To make a request, use the
          <a href="MoMoMe Contact.html"> contact page</a> and include any payment reference involved.
        </p>
      </Sec>

      <Sec n="06" title="Security">
        <p>
          Payment data is encrypted in transit and at rest, and access is limited to staff who need it to run
          the service or support you. No system is perfectly secure, but we work to industry standards and act
          quickly if something goes wrong.
        </p>
      </Sec>

      <Sec n="07" title="Children">
        <p>MoMo›Me is intended for adults. We do not knowingly collect data from anyone under 18.</p>
      </Sec>

      <Sec n="08" title="Changes &amp; contact">
        <p>
          We’ll update this policy as the service evolves; the date above shows the current version. Privacy
          questions can go to our team via the <a href="MoMoMe Contact.html">contact page</a>.
        </p>
      </Sec>
    </DocShell>
  );
}

/* ============================================================
   CONTACT / SUPPORT
   ============================================================ */
function ContactDoc() {
  return (
    <DocShell kicker="Support" title="We’re here to help" updated={null} current="contact">
      <p className="lead" style={{ fontSize: 17, color: "var(--ink-2)", marginTop: 18 }}>
        Have a question about a payment, or something not working? Reach us the way that suits you — keep your
        reference (e.g. <span className="mono">MMM-2026-000123</span>) handy and we’ll find it fast.
      </p>

      <div className="contact-grid">
        <a className="contact-card" href="https://wa.me/237600000000" target="_blank" rel="noopener noreferrer">
          <div className="ic">💬</div>
          <h3>WhatsApp</h3>
          <p>Fastest for payment questions. Send us your reference and we’ll trace it.</p>
          <span className="val">Chat on WhatsApp →</span>
        </a>
        <a className="contact-card" href="mailto:support@momome.app">
          <div className="ic">✉️</div>
          <h3>Email</h3>
          <p>Best for documents or anything detailed. We reply within one business day.</p>
          <span className="val">support@momome.app →</span>
        </a>
        <a className="contact-card" href="tel:+237600000000">
          <div className="ic">📞</div>
          <h3>Call us</h3>
          <p>Talk to a person during support hours, listed below.</p>
          <span className="val">+237 6 00 00 00 00 →</span>
        </a>
        <a className="contact-card" href="MoMoMe Send Flow.html#help">
          <div className="ic">❓</div>
          <h3>Help &amp; FAQ</h3>
          <p>Quick answers to the most common questions, right inside the pay flow.</p>
          <span className="val">Open Help →</span>
        </a>
      </div>

      <div className="hours">
        <h3>Support hours (WAT)</h3>
        <div className="row"><span>Monday – Friday</span><span>07:00 – 22:00</span></div>
        <div className="row"><span>Saturday</span><span>09:00 – 18:00</span></div>
        <div className="row"><span>Sunday &amp; public holidays</span><span>10:00 – 16:00</span></div>
      </div>

      <p style={{ marginTop: 24, fontSize: 13.5, color: "var(--ink-3)" }}>
        For partner, compliance, or press enquiries, see the <a href="MoMoMe Admin.html">partner portal</a>.
        Read our <a href="MoMoMe Terms.html">Terms</a> and <a href="MoMoMe Privacy.html">Privacy Policy</a>.
      </p>
    </DocShell>
  );
}

/* ============================================================
   404 — NOT FOUND
   ============================================================ */
function NotFoundDoc() {
  return (
    <div className="page">
      <PageTop />
      <div className="nf">
        <div className="nf-inner">
          <div className="nf-code">4<span className="arrow">›</span>4</div>
          <h1>This page took a wrong turn</h1>
          <p>
            The page you’re after doesn’t exist or has moved. Your money is safe — nothing here affects a
            payment in progress.
          </p>
          <div className="nf-actions">
            <a className="btn btn-primary" href="MoMoMe Send Flow.html">Pay Mobile Money</a>
            <a className="btn btn-ghost" href="index.html">Back to home</a>
          </div>
          <div className="nf-links">
            Looking for something? Try <a href="MoMoMe Contact.html">Help &amp; support</a>,{" "}
            <a href="MoMoMe Terms.html">Terms</a>, or <a href="MoMoMe Privacy.html">Privacy</a>.
          </div>
        </div>
      </div>
      <PageFoot current={null} />
    </div>
  );
}

/* ---------- router ---------- */
const MM_PAGES = { terms: TermsDoc, privacy: PrivacyDoc, contact: ContactDoc, notfound: NotFoundDoc };
const Doc = MM_PAGES[window.MMPAGE] || MM_PAGES.notfound;
ReactDOM.createRoot(document.getElementById("root")).render(<Doc />);
