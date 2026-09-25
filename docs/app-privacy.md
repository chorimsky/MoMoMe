# App Privacy label (iOS), and what it was derived from

Published to App Store Connect on 2026-09-25. Recorded here because the questionnaire is a
legal attestation ("your responses are accurate… and you will promptly update your responses
if your data practices change") and the only other copy of the answers lives in Apple's UI,
where nobody reviewing a pull request will see them drift.

Every answer below was read out of the code, not assumed.

| Data type | Source in the code | Purpose | Linked | Tracking |
|---|---|---|---|---|
| Phone Number | `Recipient.phone`, the sender's own verified number | App Functionality | yes | no |
| Name | `Recipient.name` — the account name the operator returns | App Functionality | yes | no |
| Other Financial Info | `Payment.xaf` / `feeXaf` / `totalXaf` and transfer history | App Functionality | yes | no |
| Coarse Location | `Payment.senderLocation` — IP → country/region/city, kept for fraud and AML review | App Functionality | yes | no |
| Device ID | `Payment.senderId`, the device-as-account id; push token | App Functionality | yes | no |
| User ID | the same id, which in this design *is* the account | App Functionality | yes | no |

`senderLocation` is the one that is easy to miss. There is no location permission and no
`expo-location`; the coarse location is resolved server-side from the request IP. It is still
collected, it is still linked, and it still has to be on the label.

## Deliberately declared as NOT collected

**Payment Info.** The sender pays from a wallet they already hold; card and account numbers
are never entered in the app and never reach us. Apple's own wording covers this case: if the
payment information is entered outside your app and you never have access to it, it is not
Collected.

**Contacts.** The payee vault is encrypted on the device with a key the server does not have
(`shared/types.ts`, `Contact`), and syncs as an opaque `VaultRecord`. The plaintext is never
accessible to us, so it is not collected. The device address book is read only when the user
taps "From phone", and nothing from it is uploaded — which is what
`NSContactsUsageDescription` already promises.

**Diagnostics / Usage Data.** There is no analytics or crash SDK in `mobile/package.json`.
Sentry is server-side only. If one is ever added, this label is wrong the day it ships.

## Also set at the same time

Age rating **4+** (172 countries), content rights "no third-party content", category
**Finance**, price **free in all 175 regions**, privacy policy `momome.xyz/privacy`.

The content-rights answer is the one worth a second look: Discover lists third-party
businesses, but they supply their own listing, so "does not contain third-party content" is
the ordinary reading for a payments app. If that ever feels wrong it is one click to flip.
