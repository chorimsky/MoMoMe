/* App Store Connect listing, pushed with `eas metadata:push`.
 *
 * A .js file rather than the .json that `eas metadata:pull` writes, for one reason: App
 * Review needs a working account, and ours is a phone number plus a one-time code. Those
 * are the REVIEW_PHONE/REVIEW_OTP pair that already lives on Railway — a credential, not
 * listing copy, and it does not belong in git. Reading it from the environment keeps the
 * public half of the listing versioned and the private half out.
 *
 *   cd mobile && REVIEW_PHONE=… REVIEW_OTP=… APPLE_REVIEW_CONTACT='First Last <email>' \
 *     npx eas-cli@latest metadata:push
 *
 * What this file CANNOT do, because EAS Metadata does not cover it: screenshots and the App
 * Privacy questionnaire. Both are required before Apple will accept a submission, and both
 * are done in App Store Connect by hand.
 *
 * Wording follows the house rule that the product is Mobile Money, described as the customer
 * experiences it. How a transfer is settled between operators is plumbing, and naming the
 * rail in a store listing would both confuse the reader and invite a 3.1.5(b) review of an
 * app that is not an exchange and holds no customer assets.
 */
const contact = (process.env.APPLE_REVIEW_CONTACT || '').trim();
const m = contact.match(/^(\S+)\s+(.*?)\s*<([^>]+)>$/);

const review = {
  demoRequired: true,
  demoUsername: process.env.REVIEW_PHONE || '',
  demoPassword: process.env.REVIEW_OTP || '',
  notes: [
    'HOW TO GET IN',
    '',
    'The app has no username/password login. Verifying a phone number sends a 6-digit code by',
    'SMS, which a reviewer outside Cameroon cannot receive, so a dedicated review number with',
    'a fixed code is provided above.',
    '',
    '1. Anywhere the app asks for a Mobile Money number to verify ("own your number", or',
    '   merchant verification), leave the country at +237 (Cameroon, the default) and enter',
    '   the number given above.',
    '2. When asked for the 6-digit code, enter the code given above. No SMS is sent for this',
    '   number.',
    '',
    'This number is treated as a normal number in every other respect, and the server refuses',
    'it as a payment recipient, so no funds can reach it.',
    '',
    'WHAT THE APP DOES',
    '',
    'momome sends money to MTN Mobile Money and Orange Money accounts in Cameroon. The sender',
    'funds a transfer from a wallet they already hold elsewhere (Lightning/Bitcoin or USDT);',
    'momome converts at a rate quoted and locked before the sender confirms, and pays the',
    'recipient in CFA francs (XAF).',
    '',
    'On 3.1.5(b): momome is not a cryptocurrency exchange and does not provide wallet',
    'services. There is no way in the app to buy, sell, trade, hold or withdraw a crypto',
    'balance, no order book, no price speculation, and no custody of customer assets. Each',
    'transfer is a single payment that is funded, converted and paid out in one movement.',
    'Customer funds are not held between transfers.',
    '',
    'NOTE ON COMPLETING A TRANSFER',
    '',
    'Reviewing the full flow end to end requires paying a real invoice from an external',
    'wallet, which we do not expect a reviewer to do. Every screen up to and including the',
    'payment instruction is reachable without paying. If you would like us to walk a transfer',
    'through on a call or to supply a funded test wallet, please use the contact above and we',
    'will arrange it same day.',
    '',
    'The app is in English and French; French is selected automatically for French-language',
    'devices and can be switched in More > Language.',
  ].join('\n'),
  firstName: m ? m[1] : '',
  lastName: m ? m[2] : '',
  email: m ? m[3] : '',
  phone: process.env.APPLE_REVIEW_PHONE || '',
};

// Apple contacts this person if review has a question, so a placeholder here is worse than a
// failed push: it would be a real submission with a contact nobody answers.
if (!review.email || !review.phone || !review.demoUsername || !review.demoPassword) {
  throw new Error(
    'store.config.js: missing reviewer details. Set all four before `eas metadata:push`:\n' +
    "  APPLE_REVIEW_CONTACT='First Last <email@example.com>'\n" +
    '  APPLE_REVIEW_PHONE=+237XXXXXXXXX\n' +
    '  REVIEW_PHONE / REVIEW_OTP   (both already on Railway — read them from there)'
  );
}

const en = {
  title: 'momome — Mobile Money',
  subtitle: 'Send to MTN & Orange Money',
  description: [
    'Send money to any Mobile Money number in Cameroon, and watch it arrive.',
    '',
    'momome pays MTN Mobile Money and Orange Money accounts directly. Enter a number, enter',
    'an amount, see exactly what the recipient will get before you confirm — and get a',
    'receipt with a reference you can look up later.',
    '',
    'WHAT YOU CAN DO',
    '• Send to any MTN or Orange Money number in Cameroon',
    '• See the amount, the fee and the total before you pay — no surprises at the end',
    '• Follow a transfer from the moment you confirm until it lands',
    '• Keep a receipt for every transfer, with a reference you can quote to support',
    '• Request money: send someone a link or a QR code and let them pay you',
    '• Save the people you pay often, encrypted on your device',
    '',
    'FOR BUSINESSES',
    'Take Mobile Money payments with a QR code on the counter or a payment link in a chat.',
    'Every payment arrives with a reference, and the day’s takings are one screen.',
    '',
    'BUILT FOR HOW MONEY ACTUALLY MOVES HERE',
    'Amounts in CFA francs. French and English. Works on a slow connection. If a transfer',
    'cannot be completed, you are told plainly and the money comes back — not a spinner that',
    'never resolves.',
    '',
    'momome is a payment service. It is not a bank, and it does not hold your money between',
    'transfers.',
  ].join('\n'),
  keywords: ['mobile money', 'MTN', 'Orange Money', 'Cameroun', 'transfert', 'envoyer argent', 'CFA', 'paiement'],
  releaseNotes: [
    'First release.',
    '',
    'Send to MTN and Orange Money, request money by link or QR code, and keep a receipt for',
    'every transfer.',
  ].join('\n'),
  promoText: 'Send money to any MTN or Orange Money number in Cameroon — and see exactly what arrives before you confirm.',
  marketingUrl: 'https://www.momome.xyz',
  supportUrl: 'https://www.momome.xyz/support',
  privacyPolicyUrl: 'https://www.momome.xyz/privacy',
};

const fr = {
  title: 'momome — Mobile Money',
  subtitle: 'Vers MTN & Orange Money',
  description: [
    'Envoyez de l’argent vers n’importe quel numéro Mobile Money au Cameroun, et suivez-le',
    'jusqu’à son arrivée.',
    '',
    'momome paie directement les comptes MTN Mobile Money et Orange Money. Saisissez un',
    'numéro, saisissez un montant, voyez exactement ce que le destinataire va recevoir avant',
    'de confirmer — et recevez un reçu avec une référence consultable plus tard.',
    '',
    'CE QUE VOUS POUVEZ FAIRE',
    '• Envoyer vers tout numéro MTN ou Orange Money au Cameroun',
    '• Voir le montant, les frais et le total avant de payer — aucune surprise à la fin',
    '• Suivre un transfert depuis la confirmation jusqu’à sa réception',
    '• Conserver un reçu pour chaque transfert, avec une référence à citer au support',
    '• Demander de l’argent : envoyez un lien ou un QR code et laissez-vous payer',
    '• Enregistrer les personnes que vous payez souvent, chiffrées sur votre appareil',
    '',
    'POUR LES COMMERÇANTS',
    'Encaissez en Mobile Money avec un QR code sur le comptoir ou un lien de paiement dans',
    'une conversation. Chaque paiement arrive avec une référence, et la recette du jour tient',
    'sur un écran.',
    '',
    'PENSÉ POUR LA RÉALITÉ LOCALE',
    'Montants en francs CFA. Français et anglais. Fonctionne sur une connexion lente. Si un',
    'transfert ne peut aboutir, on vous le dit clairement et l’argent revient — pas un',
    'chargement qui tourne sans fin.',
    '',
    'momome est un service de paiement. Ce n’est pas une banque et il ne conserve pas votre',
    'argent entre deux transferts.',
  ].join('\n'),
  keywords: ['mobile money', 'MTN', 'Orange Money', 'Cameroun', 'transfert', 'envoyer argent', 'CFA', 'paiement'],
  releaseNotes: [
    'Première version.',
    '',
    'Envoyez vers MTN et Orange Money, demandez de l’argent par lien ou QR code, et gardez un',
    'reçu pour chaque transfert.',
  ].join('\n'),
  promoText: 'Envoyez vers tout numéro MTN ou Orange Money au Cameroun — et voyez ce qui arrive avant de confirmer.',
  marketingUrl: 'https://www.momome.xyz',
  supportUrl: 'https://www.momome.xyz/support',
  privacyPolicyUrl: 'https://www.momome.xyz/privacy',
};

module.exports = {
  configVersion: 0,
  apple: {
    version: '1.1.0',
    copyright: `${new Date().getFullYear()} momome`,
    categories: ['FINANCE'],
    // Manual: a first release should be released by a person who has looked at it, not by a
    // clock. Switch to automaticRelease once there is a second version to compare against.
    release: { automaticRelease: false },
    advisory: {
      // Required by the schema even when they say nothing: a finance app is not age-banded
      // for children and claims no regional override.
      kidsAgeBand: null,
      ageRatingOverride: 'NONE',
      koreaAgeRatingOverride: 'NONE',
      alcoholTobaccoOrDrugUseOrReferences: 'NONE',
      contests: 'NONE',
      gambling: false,
      gamblingSimulated: 'NONE',
      horrorOrFearThemes: 'NONE',
      matureOrSuggestiveThemes: 'NONE',
      medicalOrTreatmentInformation: 'NONE',
      profanityOrCrudeHumor: 'NONE',
      sexualContentGraphicAndNudity: 'NONE',
      sexualContentOrNudity: 'NONE',
      unrestrictedWebAccess: false,
      violenceCartoonOrFantasy: 'NONE',
      violenceRealistic: 'NONE',
      violenceRealisticProlongedGraphicOrSadistic: 'NONE',
    },
    review,
    info: { 'en-US': en, 'fr-FR': fr },
  },
};
