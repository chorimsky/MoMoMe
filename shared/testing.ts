/* ============================================================
   Tester programme — the checklist testers run on momome.xyz/test.

   Lives in shared/ so the page that shows it and the server that records results agree on
   the case ids: a report naming a case the server does not know is refused, and the admin
   view can print titles for ids without trusting the client's copy of them.

   Every string is an [en, fr] pair, the same convention as the app's own copy.
   ============================================================ */

export type TestPlatform = "web" | "android" | "ios";
export type TestOutcome = "pass" | "fail" | "skip";

export interface TestCase {
  id: string;
  section: string;
  title: [string, string];
  /** What to do. One line. */
  step: [string, string];
  /** What "correct" looks like. One line. */
  expect: [string, string];
  /** Omitted = every platform. */
  platforms?: TestPlatform[];
  /** Reaches Confirm & pay: real money on the live app. */
  money?: boolean;
}

export const TEST_SECTIONS: Array<{ id: string; title: [string, string]; where: [string, string] }> = [
  { id: "send", title: ["Send", "Envoyer"], where: ["Send tab · momome.xyz/send", "Onglet Envoyer · momome.xyz/send"] },
  { id: "pay", title: ["Pay", "Payer"], where: ["only with the team's number and amount", "uniquement avec le numéro et le montant fournis par l'équipe"] },
  { id: "receive", title: ["Receive", "Recevoir"], where: ["Receive tab · momome.xyz/receive", "Onglet Recevoir · momome.xyz/receive"] },
  { id: "contacts", title: ["Contacts", "Contacts"], where: ["More › Contacts", "Plus › Contacts"] },
  { id: "more", title: ["Everything else", "Le reste"], where: ["More tab", "Onglet Plus"] },
];

export const TEST_CASES: TestCase[] = [
  { id: "1", section: "send", title: ["Wrong numbers are refused", "Les mauvais numéros sont refusés"],
    step: ["Type 8 digits. Then 612345678.", "Tapez 8 chiffres. Puis 612345678."],
    expect: ["Each gets a clear message and you can't continue.", "Chacun affiche un message clair et vous ne pouvez pas continuer."] },
  { id: "2", section: "send", title: ["Operator is named", "L'opérateur est indiqué"],
    step: ["Type an MTN number, then an Orange one.", "Tapez un numéro MTN, puis un numéro Orange."],
    expect: ["MTN / Orange shows up on its own.", "MTN / Orange s'affiche tout seul."] },
  { id: "3", section: "send", title: ["Registered name shows", "Le nom enregistré s'affiche"],
    step: ["Type the known number.", "Tapez le numéro connu."],
    expect: ["The holder's name appears with a green tick.", "Le nom du titulaire apparaît avec une coche verte."] },
  { id: "4", section: "send", title: ["Wrong name is challenged", "Un mauvais nom est contesté"],
    step: ["Open Send from a contact you saved under a made-up name (case 12).", "Ouvrez Envoyer depuis un contact enregistré sous un faux nom (cas 12)."],
    expect: ["The app warns the number belongs to someone else and asks you to confirm before paying.", "L'app avertit que le numéro appartient à quelqu'un d'autre et demande confirmation avant de payer."] },
  { id: "5", section: "send", title: ["Amount and Review look right", "Montant et récapitulatif corrects"],
    step: ["Enter 5000, pick Instant, go to Review.", "Saisissez 5000, choisissez Instantané, allez au récapitulatif."],
    expect: ["Name, amount, fee and \"Total to pay\" in XAF, plus a countdown. No crypto words.", "Nom, montant, frais et « Total à payer » en XAF, plus un compte à rebours. Aucun mot crypto."] },
  { id: "6", section: "send", title: ["Back and Start over", "Retour et Recommencer"],
    step: ["From Review go back, change the amount, return. Then Start over.", "Depuis le récapitulatif, revenez, changez le montant, revenez. Puis Recommencer."],
    expect: ["Back keeps the recipient. Start over clears everything.", "Retour garde le bénéficiaire. Recommencer efface tout."] },

  { id: "7", section: "pay", money: true, title: ["Payment goes through", "Le paiement aboutit"],
    step: ["Confirm & pay, then pay the code shown.", "Confirmer et payer, puis payez le code affiché."],
    expect: ["The screen turns to Delivered by itself, and the recipient gets the operator SMS for the same amount.", "L'écran passe à Livré tout seul, et le bénéficiaire reçoit le SMS de l'opérateur pour le même montant."] },
  { id: "8", section: "pay", money: true, title: ["Receipt", "Reçu"],
    step: ["Open the receipt, then find it again under Activity.", "Ouvrez le reçu, puis retrouvez-le dans Activité."],
    expect: ["Name, amount, fee, date and reference are right. Share works.", "Nom, montant, frais, date et référence sont corrects. Le partage fonctionne."] },

  { id: "9", section: "receive", title: ["Your pay link works", "Votre lien de paiement fonctionne"],
    step: ["Enter your number and 1000, share the link to yourself, open it.", "Saisissez votre numéro et 1000, partagez-vous le lien, ouvrez-le."],
    expect: ["It opens Send with your number, name and amount already filled.", "Il ouvre Envoyer avec votre numéro, nom et montant déjà remplis."] },
  { id: "10", section: "receive", platforms: ["android", "ios"], title: ["Scan the code", "Scanner le code"],
    step: ["Show the QR on one screen, scan it from the Scan tab on another phone.", "Affichez le QR sur un écran, scannez-le depuis l'onglet Scanner d'un autre téléphone."],
    expect: ["Camera permission is explained, and the scan opens Send filled in.", "La permission caméra est expliquée, et le scan ouvre Envoyer pré-rempli."] },

  { id: "11", section: "contacts", platforms: ["android", "ios"], title: ["Keyboard doesn't hide the form", "Le clavier ne cache pas le formulaire"],
    step: ["Add contact, tap Name, then the number, then the note.", "Ajouter un contact, touchez Nom, puis le numéro, puis la note."],
    expect: ["The field you type in is always visible, and you can reach Save.", "Le champ où vous tapez reste visible, et vous pouvez atteindre Enregistrer."] },
  { id: "12", section: "contacts", title: ["Registered name is offered", "Le nom enregistré est proposé"],
    step: ["Type a made-up name and the known number.", "Tapez un faux nom et le numéro connu."],
    expect: ["A box shows who the number belongs to and offers \"Use the registered name\". Save under the made-up name anyway, for case 4.", "Un encadré indique le titulaire et propose « Utiliser le nom enregistré ». Enregistrez quand même sous le faux nom, pour le cas 4."] },
  { id: "13", section: "contacts", platforms: ["android", "ios"], title: ["From phone", "Depuis le téléphone"],
    step: ["Add contact › From phone, pick someone with a Cameroon number.", "Ajouter un contact › Depuis le téléphone, choisissez quelqu'un avec un numéro camerounais."],
    expect: ["Their name and number fill in.", "Son nom et son numéro se remplissent."] },
  { id: "14", section: "contacts", title: ["Edit, star, delete, duplicate", "Modifier, favori, supprimer, doublon"],
    step: ["Edit a name. Star one. Delete one. Add the same number twice.", "Modifiez un nom. Mettez-en un en favori. Supprimez-en un. Ajoutez deux fois le même numéro."],
    expect: ["Edits stick, stars go first, delete asks first, the duplicate is refused.", "Les modifications restent, les favoris passent devant, la suppression demande confirmation, le doublon est refusé."] },
  { id: "15", section: "contacts", title: ["Back up & restore", "Sauvegarde et restauration"],
    step: ["Back up with a passphrase, restore on another device or a private window.", "Sauvegardez avec une phrase secrète, restaurez sur un autre appareil ou une fenêtre privée."],
    expect: ["All contacts come back. A wrong passphrase restores nothing.", "Tous les contacts reviennent. Une mauvaise phrase ne restaure rien."] },

  { id: "16", section: "more", title: ["Discover", "Découvrir"],
    step: ["Search a business, tap it.", "Cherchez un commerce, touchez-le."],
    expect: ["Its pay page opens with name and number fixed. No result shows a friendly message.", "Sa page de paiement s'ouvre avec nom et numéro fixes. Sans résultat, un message clair s'affiche."] },
  { id: "17", section: "more", title: ["French", "Français"],
    step: ["Switch to Français, then walk through Send, Contacts and Receive.", "Passez en français, puis parcourez Envoyer, Contacts et Recevoir."],
    expect: ["Nothing is left in English. Amounts read 5 000 XAF.", "Plus rien en anglais. Les montants s'affichent 5 000 XAF."] },
  { id: "18", section: "more", title: ["Dark mode", "Mode sombre"],
    step: ["Put the phone in dark mode, open every tab.", "Mettez le téléphone en mode sombre, ouvrez chaque onglet."],
    expect: ["Everything is readable, including the QR code and receipt.", "Tout est lisible, y compris le QR et le reçu."] },
  { id: "19", section: "more", title: ["No internet", "Sans internet"],
    step: ["Airplane mode on the Send screen, then turn it off.", "Mode avion sur l'écran Envoyer, puis désactivez-le."],
    expect: ["A clear \"no connection\" message, and it recovers without restarting.", "Un message clair « pas de connexion », et ça reprend sans redémarrer."] },
  { id: "20", section: "more", title: ["Delete my data", "Supprimer mes données"],
    step: ["More › Delete account (or momome.xyz/delete-account). Read it; submit only from a device you're done with.", "Plus › Supprimer le compte (ou momome.xyz/delete-account). Lisez ; n'envoyez que depuis un appareil dont vous n'avez plus besoin."],
    expect: ["It says what is deleted and what is kept, and gives a reference.", "Il indique ce qui est supprimé et conservé, et donne une référence."] },
];

export const TEST_CASE_IDS = new Set(TEST_CASES.map((c) => c.id));

export function casesFor(platform: TestPlatform): TestCase[] {
  return TEST_CASES.filter((c) => !c.platforms || c.platforms.includes(platform));
}
