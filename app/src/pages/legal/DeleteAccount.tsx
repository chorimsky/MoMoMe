/* Account and data deletion — the public URL Google Play requires.
 *
 * Play's Data Safety section cannot be completed by an app that lets people create an
 * account unless deletion is offered BOTH in the app and at a web address reachable by
 * someone who has already uninstalled it. This is that address.
 *
 * It is deliberately a page that DOES the thing rather than a form that emails a request:
 * the account here is the device, so the browser presenting the device id is the only
 * party that can prove ownership, and it can act immediately. A person on a different
 * device gets told plainly why the button cannot help them, instead of a request that
 * silently goes nowhere.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CountryCode } from "@shared/types.js";
import { COUNTRIES, checkPhone } from "@shared/domain.js";
import { DocShell, Sec, Summary } from "./LegalLayout.js";
import { useI18n } from "../../lib/i18n.js";
import { api, ApiError } from "../../api/client.js";

interface DeleteResult {
  deleted: { contacts: number; device: boolean; referrals: boolean };
  retained: { payments: number; reason: string };
}

export function DeleteAccount() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const L = (en: string, frText: string) => (fr ? frText : en);
  const [state, setState] = useState<"idle" | "confirming" | "working" | "done" | "error">("idle");
  const [result, setResult] = useState<DeleteResult | null>(null);
  const [error, setError] = useState<string>("");
  const [noDevice, setNoDevice] = useState(false);

  // The request form, for someone reading this on a device that is not their MoMo›Me
  // account (an uninstalled app, a different phone, a Play reviewer). They cannot prove
  // ownership, so nothing is deleted here — the request is put on record and answered.
  const [rqCountry, setRqCountry] = useState<CountryCode>("CM");
  const [rqPhone, setRqPhone] = useState("");
  const [rqNote, setRqNote] = useState("");
  const [rqState, setRqState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [rqRef, setRqRef] = useState<{ ref: string; alreadyOpen: boolean } | null>(null);
  const [rqError, setRqError] = useState("");
  const rqCheck = checkPhone(rqPhone, rqCountry);

  useEffect(() => { document.title = "Delete your account · MoMo›Me"; }, []);

  async function request() {
    setRqState("working"); setRqError("");
    try {
      const r = await api.requestDeletion({ phone: rqCheck.local, country: rqCountry, note: rqNote.trim() || undefined });
      setRqRef({ ref: r.ref, alreadyOpen: r.alreadyOpen });
      setRqState("done");
    } catch (e) {
      setRqError(e instanceof Error ? e.message : "Something went wrong.");
      setRqState("error");
    }
  }

  async function run() {
    setState("working");
    try {
      const r = await api.deleteAccount();
      setResult(r);
      setState("done");
    } catch (e) {
      // "Unrecognised device" is not a failure — it is the ordinary case for someone who
      // has uninstalled the app. Send them to the form instead of a dead end.
      if (e instanceof ApiError && e.status === 401) setNoDevice(true);
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  }

  return (
    <DocShell kicker={L("Legal", "Juridique")} title={L("Delete your account", "Supprimer votre compte")} updated={L("3 September 2026", "3 septembre 2026")} current="privacy" langToggle>
      <Summary>
        {L("You can delete your MoMo›Me account and the data tied to it from this page, on this device. Your saved contacts, this device’s keys and your referral links go immediately. Records of payments you have already sent are kept, because the law that governs money transfer requires it.",
           "Vous pouvez supprimer votre compte MoMo›Me et les données qui y sont liées depuis cette page, sur cet appareil. Vos contacts enregistrés, les clés de cet appareil et vos liens de parrainage disparaissent immédiatement. Les enregistrements des paiements déjà envoyés sont conservés, parce que la loi qui régit le transfert d'argent l'exige.")}
      </Summary>

      <Sec n="01" title={L("What gets deleted", "Ce qui est supprimé")}>
        <ul>
          <li><strong>{L("Your saved contacts", "Vos contacts enregistrés")}</strong> — {L("the encrypted address book kept for you. It is stored end-to-end encrypted, so we have never been able to read it; deleting it destroys the ciphertext.", "le carnet d'adresses chiffré conservé pour vous. Il est chiffré de bout en bout, nous n'avons donc jamais pu le lire ; le supprimer détruit le texte chiffré.")}</li>
          <li><strong>{L("This device", "Cet appareil")}</strong> — {L("its enrolment and the public keys that made it your account.", "son enrôlement et les clés publiques qui en faisaient votre compte.")}</li>
          <li><strong>{L("Your referral links", "Vos liens de parrainage")}</strong> — {L("your code, who referred you, and your place in anyone else’s referral list.", "votre code, la personne qui vous a parrainé, et votre place dans la liste de parrainage d'autrui.")}</li>
        </ul>
      </Sec>

      <Sec n="02" title={L("What we have to keep, and why", "Ce que nous devons garder, et pourquoi")}>
        <p>
          {L("Records of payments you have already sent stay. Moving money makes us a regulated money transmitter, and anti-money-laundering law requires those records be retained for several years — we are not permitted to erase them on request, and our books are double-entry, so removing one side of a completed payment would unbalance it for everyone else involved. What we can do, and do here, is cut the link between those records and a device you control. They are covered in full by our ",
             "Les enregistrements des paiements déjà envoyés restent. Transférer de l'argent fait de nous un transmetteur de fonds réglementé, et la loi anti-blanchiment impose de conserver ces enregistrements plusieurs années — nous n'avons pas le droit de les effacer sur demande, et notre comptabilité est en partie double : retirer un côté d'un paiement achevé le déséquilibrerait pour toutes les autres parties. Ce que nous pouvons faire, et faisons ici, c'est couper le lien entre ces enregistrements et un appareil que vous contrôlez. Ils sont couverts intégralement par notre ")}
          <Link to="/privacy">{L("Privacy Policy", "Politique de confidentialité")}</Link>.
        </p>
      </Sec>

      <Sec n="03" title={L("Delete now", "Supprimer maintenant")}>
        <p>
          {L("This acts on ", "Ceci agit sur ")}<strong>{L("this browser or app install", "ce navigateur ou cette installation de l'app")}</strong>{L(", which is what identifies your account. If you are reading this somewhere else, open it on the device you used MoMo›Me on — we have no other way to know the account is yours, and we would rather say so than take a request we cannot verify. This cannot be undone.",
             ", qui est ce qui identifie votre compte. Si vous lisez ceci ailleurs, ouvrez cette page sur l'appareil avec lequel vous avez utilisé MoMo›Me — nous n'avons aucun autre moyen de savoir que le compte est le vôtre, et nous préférons le dire plutôt qu'accepter une demande que nous ne pouvons pas vérifier. Cette action est irréversible.")}
        </p>

        {state === "idle" && (
          <p>
            <button type="button" className="btn btn-danger" onClick={() => setState("confirming")}>
              {L("Delete my account", "Supprimer mon compte")}
            </button>
          </p>
        )}

        {state === "confirming" && (
          <p>
            <strong>{L("Delete your account and its data from this device?", "Supprimer votre compte et ses données de cet appareil ?")}</strong> {L("This cannot be undone.", "Cette action est irréversible.")}{" "}
            <button type="button" className="btn btn-danger" onClick={run}>{L("Yes, delete it", "Oui, supprimer")}</button>{" "}
            <button type="button" className="btn" onClick={() => setState("idle")}>{L("Cancel", "Annuler")}</button>
          </p>
        )}

        {state === "working" && <p>{L("Deleting…", "Suppression…")}</p>}

        {state === "done" && result && (
          <>
            <p><strong>{L("Done.", "Terminé.")}</strong> {L("Here is exactly what happened:", "Voici exactement ce qui s'est passé :")}</p>
            <ul>
              <li>{fr ? `${result.deleted.contacts} contact${result.deleted.contacts === 1 ? "" : "s"} enregistré${result.deleted.contacts === 1 ? "" : "s"} supprimé${result.deleted.contacts === 1 ? "" : "s"}` : `${result.deleted.contacts} saved contact${result.deleted.contacts === 1 ? "" : "s"} deleted`}</li>
              <li>{result.deleted.device ? L("This device’s keys were removed", "Les clés de cet appareil ont été supprimées") : L("This device had no keys stored", "Cet appareil n'avait aucune clé enregistrée")}</li>
              <li>{result.deleted.referrals ? L("Referral links removed", "Liens de parrainage supprimés") : L("No referral links to remove", "Aucun lien de parrainage à supprimer")}</li>
              <li>
                {result.retained.payments} past payment record
                {result.retained.payments === 1 ? "" : "s"} kept — {result.retained.reason}
              </li>
            </ul>
          </>
        )}

        {state === "error" && noDevice && (
          <p>
            <strong>{L("This browser is not a MoMo›Me account", "Ce navigateur n'est pas un compte MoMo›Me")}</strong> — {L("it has never been used to send money here, so there is nothing tied to it that we could delete. If you used the app on a phone you no longer have, use the request form below and we will handle it by hand.", "il n'a jamais servi à envoyer de l'argent ici, il n'y a donc rien qui lui soit lié que nous puissions supprimer. Si vous avez utilisé l'app sur un téléphone que vous n'avez plus, utilisez le formulaire ci-dessous et nous traiterons la demande à la main.")}
          </p>
        )}
        {state === "error" && !noDevice && (
          <p>
            {L("We couldn’t complete that: ", "Nous n'avons pas pu terminer : ")}{error} {L("If this keeps happening, use the request form below or the", "Si cela se reproduit, utilisez le formulaire ci-dessous ou la")}{" "}
            <Link to="/contact">{L("contact page", "page de contact")}</Link> {L("and we will handle it by hand.", "et nous traiterons la demande à la main.")}
          </p>
        )}
      </Sec>

      <Sec n="04" title={L("Not on that device any more? Ask us", "Plus cet appareil ? Demandez-nous")}>
        <p>
          {L("If you have uninstalled the app or lost the phone, tell us the Mobile Money number you used with MoMo›Me. We can’t verify ownership from here, so nothing is deleted on the spot: your request is put on record with a reference, we confirm the number is yours, and we delete what we can within 30 days. Keep the reference.",
             "Si vous avez désinstallé l'app ou perdu le téléphone, indiquez-nous le numéro Mobile Money utilisé avec MoMo›Me. Nous ne pouvons pas vérifier la propriété d'ici, donc rien n'est supprimé sur-le-champ : votre demande est enregistrée avec une référence, nous confirmons que le numéro est le vôtre, et nous supprimons ce que nous pouvons sous 30 jours. Conservez la référence.")}
        </p>
        {rqState !== "done" && (
          <form onSubmit={(e) => { e.preventDefault(); if (rqCheck.ok) void request(); }} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              {L("Country", "Pays")}
              <select value={rqCountry} onChange={(e) => setRqCountry(e.target.value as CountryCode)}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", font: "inherit" }}>
                {Object.values(COUNTRIES).map((co) => <option key={co.code} value={co.code}>{co.dial} {co.name}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              {L("Mobile Money number", "Numéro Mobile Money")}
              <input value={rqPhone} onChange={(e) => setRqPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="6 80 34 44 85"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", font: "inherit", fontFamily: "var(--font-mono)" }} />
              {rqPhone.replace(/\D/g, "").length >= 8 && !rqCheck.ok && (
                <span style={{ color: "var(--warn-ink)", fontSize: 12.5 }}>{fr ? `Ce numéro ne ressemble pas à un numéro Mobile Money (${COUNTRIES[rqCountry].name}) — vérifiez les chiffres et le pays.` : `That doesn’t look like a ${COUNTRIES[rqCountry].name} Mobile Money number — check the digits and the country.`}</span>
              )}
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              {L("Anything we should know (optional)", "Une précision utile (facultatif)")}
              <textarea value={rqNote} onChange={(e) => setRqNote(e.target.value.slice(0, 500))} rows={2}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", font: "inherit", resize: "vertical" }} />
            </label>
            {rqState === "error" && <p style={{ color: "var(--bad)", margin: 0 }}>{rqError}</p>}
            <p style={{ margin: 0 }}>
              <button type="submit" className="btn btn-danger" disabled={!rqCheck.ok || rqState === "working"}>
                {rqState === "working" ? L("Sending…", "Envoi…") : L("Request deletion", "Demander la suppression")}
              </button>
            </p>
          </form>
        )}
        {rqState === "done" && rqRef && (
          <p>
            <strong>{rqRef.alreadyOpen ? L("We already have this request.", "Nous avons déjà cette demande.") : L("Received.", "Bien reçu.")}</strong> {L("Your reference is", "Votre référence est")}{" "}
            <strong style={{ fontFamily: "var(--font-mono)" }}>{rqRef.ref}</strong>. {L("We will confirm the number is yours and answer within 30 days. If you need to follow up, quote that reference on the", "Nous confirmerons que le numéro est le vôtre et répondrons sous 30 jours. Pour tout suivi, indiquez cette référence sur la")} <Link to="/contact">{L("contact page", "page de contact")}</Link>.
          </p>
        )}
      </Sec>
    </DocShell>
  );
}
