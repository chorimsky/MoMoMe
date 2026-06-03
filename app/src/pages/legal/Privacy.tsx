import { useEffect } from "react";
import { Link } from "react-router-dom";
import { DocShell, Sec, Summary } from "./LegalLayout.js";

export function Privacy() {
  useEffect(() => {
    document.title = "Privacy Policy · MoMo›Me";
  }, []);

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
          correct it, or ask us to delete it where we are not required to keep it. To make a request, use the{" "}
          <Link to="/contact">contact page</Link> and include any payment reference involved.
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

      <Sec n="08" title="Changes & contact">
        <p>
          We’ll update this policy as the service evolves; the date above shows the current version. Privacy
          questions can go to our team via the <Link to="/contact">contact page</Link>.
        </p>
      </Sec>
    </DocShell>
  );
}
