import { useEffect } from "react";
import { Link } from "react-router-dom";
import { DocShell, Sec, Summary } from "./LegalLayout.js";
import { useI18n } from "../../lib/i18n.js";

export function Terms() {
  const { lang } = useI18n();
  if (lang === "fr") return <TermsFr />;
  return (
    <DocShell kicker="Legal" title="Terms of Service" updated="1 June 2026" current="terms" langToggle>
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

/** The same Terms in French — the market is bilingual and the toggle on the page must
 *  change the document, not only the chrome around it. Keep both in step. */
function TermsFr() {
  return (
    <DocShell kicker="Juridique" title="Conditions d'utilisation" updated="1er juin 2026" current="terms" langToggle>
      <Summary>
        MoMo›Me vous permet d'envoyer de l'argent vers des comptes MTN Mobile Money et Orange Money. Vous
        indiquez le destinataire et le montant ; nous affichons le montant exact qui arrivera avant que vous ne
        confirmiez. Un paiement livré est définitif : vérifiez bien le numéro et le nom avant de confirmer.
      </Summary>

      <Sec n="01" title="Qui nous sommes">
        <p>
          MoMo›Me (« <strong>MoMo›Me</strong> », « nous ») exploite un service de paiement qui livre des fonds
          sur des comptes Mobile Money dans la zone franc d'Afrique centrale — actuellement le <strong>Cameroun,
          le Gabon, le Tchad, le Congo</strong> et la <strong>République centrafricaine</strong>. Les présentes
          Conditions régissent l'utilisation de notre site et de notre parcours de paiement. En lançant un
          paiement, vous les acceptez.
        </p>
      </Sec>

      <Sec n="02" title="Le service">
        <p>
          Vous pouvez payer un compte MTN Mobile Money ou Orange Money sans ouvrir de compte chez nous. Pour
          chaque paiement, vous fournissez le numéro Mobile Money du destinataire et le montant. Avant que vous
          ne confirmiez, nous affichons :
        </p>
        <ul>
          <li>le nom du destinataire renvoyé par l'opérateur Mobile Money,</li>
          <li>le montant exact qui arrivera sur le portefeuille du destinataire, en <span className="mono">XAF</span>, et</li>
          <li>tout frais, affiché séparément et jamais dissimulé dans le taux.</li>
        </ul>
        <p>
          Nous agissons comme intermédiaire qui donne instruction à l'opérateur de créditer le destinataire.
          Nous ne conservons aucun solde pour votre compte.
        </p>
      </Sec>

      <Sec n="03" title="Confirmer un paiement">
        <p>
          Un paiement est autorisé lorsque vous achevez l'étape de confirmation. Chaque paiement reçoit une
          référence, par exemple <span className="mono">MMM-2026-000123</span>. Conservez-la : c'est ainsi que
          nous et l'opérateur identifions l'opération si vous avez besoin d'aide.
        </p>
        <p>
          Vous êtes responsable de la saisie du bon numéro. Nous affichons le nom que nous recevons pour vous
          aider à repérer une erreur, mais nous ne pouvons pas récupérer des fonds livrés à un numéro que vous
          avez mal saisi.
        </p>
      </Sec>

      <Sec n="04" title="Caractère définitif et remboursements">
        <p>
          Un crédit Mobile Money est <strong>définitif une fois livré</strong> et ne peut en général pas être
          annulé. Si un paiement <em>n'est pas livré</em>, nous vous restituons le montant payé par le moyen
          d'origine, déduction faite des frais de réseau tiers inévitablement engagés. Si vous pensez qu'un
          paiement a été livré par erreur, contactez-nous avec votre référence sous <strong>30 jours</strong> ;
          nous enquêterons auprès de l'opérateur, sans pouvoir garantir la récupération.
        </p>
      </Sec>

      <Sec n="05" title="Frais et taux de change">
        <p>
          Tout frais et le taux de change appliqué sont affichés avant confirmation, puis sur votre reçu. Les
          taux suivent le marché ; le taux que vous confirmez est celui que nous honorons pour ce paiement.
        </p>
      </Sec>

      <Sec n="06" title="Usage acceptable">
        <p>Vous vous engagez à ne pas utiliser MoMo›Me pour :</p>
        <ul>
          <li>envoyer des fonds liés à une fraude, au blanchiment de capitaux ou au financement du terrorisme ;</li>
          <li>contourner des sanctions ou envoyer vers des personnes ou juridictions sanctionnées ;</li>
          <li>enfreindre la loi du pays depuis lequel ou vers lequel vous payez.</li>
        </ul>
        <p>
          Nous pouvons refuser, suspendre ou annuler un paiement, et demander des informations d'identité,
          lorsque la loi l'exige ou lorsque nous soupçonnons raisonnablement un usage abusif.
        </p>
      </Sec>

      <Sec n="07" title="Disponibilité">
        <p>
          Nous visons un service disponible en permanence, mais la livraison dépend des opérateurs Mobile
          Money et des réseaux de paiement auxquels nous nous connectons. Une panne de leur côté peut
          retarder un paiement. En cas de retard, vos fonds ne sont jamais perdus : un paiement aboutit ou est
          restitué.
        </p>
      </Sec>

      <Sec n="08" title="Responsabilité">
        <p>
          Dans la mesure permise par la loi, notre responsabilité pour un paiement est limitée au montant de ce
          paiement augmenté des frais que vous nous avez versés pour celui-ci. Nous ne sommes pas responsables
          des pertes dues à des informations erronées que vous avez fournies ou à des pannes d'opérateur hors de
          notre contrôle.
        </p>
      </Sec>

      <Sec n="09" title="Modification des conditions">
        <p>
          Nous pouvons mettre à jour ces Conditions. La date de « dernière mise à jour » ci-dessus indique la
          version en vigueur ; la version applicable à un paiement est celle affichée au moment où vous l'avez
          confirmé.
        </p>
      </Sec>

      <Sec n="10" title="Contact">
        <p>
          Une question sur ces Conditions ? Écrivez-nous via la <Link to="/contact">page de contact</Link>.
          Voir aussi notre <Link to="/privacy">Politique de confidentialité</Link>.
        </p>
      </Sec>
    </DocShell>
  );
}
