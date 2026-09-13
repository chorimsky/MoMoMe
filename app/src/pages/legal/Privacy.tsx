import { useEffect } from "react";
import { Link } from "react-router-dom";
import { DocShell, Sec, Summary } from "./LegalLayout.js";
import { useI18n } from "../../lib/i18n.js";

export function Privacy() {
  const { lang } = useI18n();
  if (lang === "fr") return <PrivacyFr />;
  return (
    <DocShell kicker="Legal" title="Privacy Policy" updated="1 June 2026" current="privacy" langToggle>
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
          You can <Link to="/delete-account">delete your account and its data</Link> yourself, from the
          device you use MoMo›Me on. Your saved contacts, that device’s keys and your referral links are
          removed straight away. Records of payments already sent are kept — anti-money-laundering law
          requires a money transmitter to retain them — and that page tells you exactly what stayed.
        </p>
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

/** The same policy in French. Keep both in step. */
function PrivacyFr() {
  return (
    <DocShell kicker="Juridique" title="Politique de confidentialité" updated="1er juin 2026" current="privacy" langToggle>
      <Summary>
        Nous ne collectons que ce qui est nécessaire pour transférer votre argent et respecter nos obligations
        légales : qui paie, qui est payé, et combien. Nous ne vendons pas vos données et nous ne vous demandons
        pas d'ouvrir un compte pour envoyer un paiement.
      </Summary>

      <Sec n="01" title="Ce que nous collectons">
        <ul>
          <li><strong>Données de paiement</strong> — le numéro Mobile Money du destinataire, le montant, le nom renvoyé par l'opérateur et la référence.</li>
          <li><strong>Données de l'expéditeur</strong> — le moyen de paiement utilisé et, lorsque la loi l'exige, des informations d'identité pour vérifier un paiement.</li>
          <li><strong>Données techniques</strong> — des informations sur l'appareil et le navigateur ainsi qu'une localisation approximative, pour sécuriser le service et prévenir la fraude.</li>
        </ul>
      </Sec>

      <Sec n="02" title="Pourquoi nous les utilisons">
        <ul>
          <li>pour livrer votre paiement sur le bon compte Mobile Money ;</li>
          <li>pour vous afficher un reçu et répondre aux demandes d'aide liées à votre référence ;</li>
          <li>pour détecter et prévenir la fraude, et respecter nos obligations de lutte contre le blanchiment et les sanctions ;</li>
          <li>pour conserver les enregistrements que la loi nous impose.</li>
        </ul>
      </Sec>

      <Sec n="03" title="Avec qui nous les partageons">
        <p>
          Nous partageons le strict nécessaire avec les parties qui font fonctionner un paiement : les
          <strong> opérateurs Mobile Money</strong> (MTN, Orange) qui créditent le destinataire, les
          <strong> partenaires de paiement et de règlement</strong> qui acheminent les fonds, et les régulateurs
          ou autorités lorsque la loi nous y oblige. Nous ne vendons <strong>pas</strong> vos données personnelles
          et ne les partageons pas à des fins publicitaires.
        </p>
      </Sec>

      <Sec n="04" title="Durée de conservation">
        <p>
          Nous conservons les enregistrements de transactions aussi longtemps que le droit des services
          financiers l'exige — généralement plusieurs années après un paiement — puis nous les supprimons ou les
          anonymisons. Les journaux de sécurité et de lutte contre la fraude sont conservés moins longtemps.
        </p>
      </Sec>

      <Sec n="05" title="Vos droits">
        <p>
          Vous pouvez <Link to="/delete-account">supprimer votre compte et ses données</Link> vous-même, depuis
          l'appareil sur lequel vous utilisez MoMo›Me. Vos contacts enregistrés, les clés de cet appareil et vos
          liens de parrainage sont supprimés immédiatement. Les enregistrements des paiements déjà envoyés sont
          conservés — la loi anti-blanchiment impose à un transmetteur de fonds de les garder — et cette page vous
          dit exactement ce qui reste.
        </p>
        <p>
          Sous réserve du droit local, vous pouvez nous demander une copie des données personnelles que nous
          détenons à votre sujet, leur rectification, ou leur suppression lorsque nous ne sommes pas tenus de les
          conserver. Pour toute demande, utilisez la <Link to="/contact">page de contact</Link> en indiquant la
          référence de paiement concernée.
        </p>
      </Sec>

      <Sec n="06" title="Sécurité">
        <p>
          Les données de paiement sont chiffrées en transit et au repos, et leur accès est limité au personnel
          qui en a besoin pour faire fonctionner le service ou vous assister. Aucun système n'est parfaitement
          sûr, mais nous travaillons selon les standards du secteur et réagissons rapidement en cas d'incident.
        </p>
      </Sec>

      <Sec n="07" title="Mineurs">
        <p>MoMo›Me s'adresse aux adultes. Nous ne collectons pas sciemment de données de personnes de moins de 18 ans.</p>
      </Sec>

      <Sec n="08" title="Modifications et contact">
        <p>
          Nous mettrons cette politique à jour au fil de l'évolution du service ; la date ci-dessus indique la
          version en vigueur. Les questions de confidentialité peuvent être adressées à notre équipe via la{" "}
          <Link to="/contact">page de contact</Link>.
        </p>
      </Sec>
    </DocShell>
  );
}
