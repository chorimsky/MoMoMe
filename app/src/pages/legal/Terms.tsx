import { useEffect } from "react";
import { Link } from "react-router-dom";
import { DocShell, Sec, Summary } from "./LegalLayout.js";

export function Terms() {
  useEffect(() => {
    document.title = "Terms of Service · MoMo›Me";
  }, []);

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

      <Sec n="04" title="Finality & refunds">
        <p>
          Mobile-money credits are <strong>final once delivered</strong> and generally cannot be reversed. If a
          payment <em>fails to deliver</em>, we return the amount you paid using the original method, less any
          third-party network fees that were unavoidably incurred. If you believe a payment was delivered in
          error, contact us with your reference within <strong>30 days</strong> and we will investigate with the
          operator, though we cannot guarantee recovery.
        </p>
      </Sec>

      <Sec n="05" title="Fees & exchange rates">
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
          Questions about these Terms? Reach us via the <Link to="/contact">contact page</Link>. See also
          our <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </Sec>
    </DocShell>
  );
}
