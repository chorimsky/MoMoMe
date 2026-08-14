# MoMo›Me — iOS & Android deployment (Expo / EAS)

> **Deploy-readiness (verified):** `expo-doctor` **20/20**, `tsc --noEmit` clean,
> `expo config` resolves (bundle ids, camera permission, deep-link filters all correct),
> and `expo export` produces a Hermes release bundle with no errors. App icons are
> 1024px (crisp store icon; alpha is flattened by EAS for iOS). Remaining work is
> account-side: `eas init`, signing, store listings, and hosting the deep-link files.


Native app (Expo SDK 57, Expo Router) that talks to the same settlement backend as the web
app. It lives in this repo but is an **isolated project** (its own `node_modules`, **not** a
pnpm workspace member) so it can never destabilise the deployed web/server stacks. It reuses
the single source of truth for the API contract via `@shared/*` → `../shared` (see
`metro.config.js` + `tsconfig.json`).

> I (Claude) can scaffold, build config, and give you exact commands, but **I cannot log into
> your Expo, Apple, or Google accounts**, and cannot handle signing secrets. Every step below
> that needs an account is one you run.

---

## 0. One-time accounts you need

| Store | Account | Cost |
|-------|---------|------|
| Both  | [Expo account](https://expo.dev/signup) (for EAS builds) | Free tier works |
| iOS   | [Apple Developer Program](https://developer.apple.com/programs/) | $99 / year |
| Android | [Google Play Console](https://play.google.com/console/signup) | $25 one-time |

---

## 1. Install tooling & dependencies

```bash
cd mobile
npm install            # base deps (already run during scaffold)
npm install -g eas-cli # the EAS build/submit CLI
```

The scaffold also installs these native modules (already in `package.json` after setup):
`expo-camera`, `expo-secure-store`, `expo-clipboard`, `react-native-svg`,
`react-native-qrcode-svg`, `@expo-google-fonts/fredoka`, `@expo-google-fonts/nunito`.
If you ever add more, use `npx expo install <pkg>` (never plain `npm install`) so versions
stay matched to the SDK.

Sanity-check the toolchain any time:

```bash
npx expo-doctor
```

---

## 2. Run it locally (fastest feedback)

```bash
cd mobile
npx expo start
```

Scan the QR with **Expo Go** (iOS/Android). Camera scanning, secure storage, and QR all work
in Expo Go. Deep links / app-store icons need a real build (step 4).

To point at a different backend while developing, create `mobile/.env` from `.env.example`
and set `EXPO_PUBLIC_API_BASE` (e.g. the Vercel backend after cutover).

---

## 3. Link the project to your Expo account

```bash
cd mobile
eas login
eas init          # creates the EAS project, writes owner + extra.eas.projectId
```

`eas init` fills in the project id automatically — no manual edit needed.

---

## 4. Build

Profiles are defined in `eas.json` (`development`, `preview`, `production`). All three bake in
`EXPO_PUBLIC_API_BASE` — edit those values if the backend URL changes.

```bash
# Internal test builds (installable on a device / simulator)
eas build --profile preview --platform android   # → .apk you can sideload
eas build --profile preview --platform ios        # needs an Apple account + a registered device

# Production store builds
eas build --profile production --platform all
```

First iOS build will prompt to create/manage signing credentials on EAS — say yes and let EAS
manage them (easiest). Android signing keystore is likewise generated and stored by EAS.

---

## 5. Submit to the stores

Fill the placeholders in `eas.json → submit.production` first:

- **iOS**: `appleId` (your Apple email), `ascAppId` (App Store Connect app's numeric ID),
  `appleTeamId`. Create the app record in App Store Connect first.
- **Android**: create a **Play service-account JSON** (Play Console → Setup → API access),
  download it to `mobile/play-service-account.json` (git-ignored — never commit it), and create
  the app + an `internal` testing track.

```bash
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

---

## 6. Over-the-air updates (optional but recommended)

JS-only changes ship without a new store review:

```bash
eas update --branch production --message "copy tweak"
```

(The `channel`s in `eas.json` already map builds to update branches.)

---

## 7. Deep links (Universal / App Links) — needs web-side hosting

`app.config.ts` declares `applinks:momome.xyz` (iOS) and an autoVerify `/pay` intent filter
(Android). For tapping `https://momome.xyz/pay/<code>` to open the app, host two files on the
web origin (add them to the Vercel frontend's `public/.well-known/`):

- `https://momome.xyz/.well-known/apple-app-site-association` (no extension, `application/json`)
- `https://momome.xyz/.well-known/assetlinks.json`

`eas build` prints the exact `appID` / SHA-256 fingerprint to put in those files. Until then,
the custom scheme `momome://` still works for in-app navigation.

---

## 8. App Store review notes (crypto apps get scrutiny)

- Provide a **demo/test path** for reviewers. If the backend has `demoMode`, the pay step shows
  a "Simulate payment" button so a reviewer can complete a flow without paying real sats.
- Have the **Privacy Policy** and **Terms** URLs ready (`momome.xyz/privacy`, `/terms`) — the
  app links to them from the More tab.
- Apple 3.1.5(b)/crypto: this app **converts crypto to Mobile Money**; it is not an exchange or
  a wallet-for-purchase. Describe it as a payments/remittance utility.
- Camera usage string is already set (QR scanning) — App Store requires the purpose string,
  which `app.config.ts` provides.

---

## What's shipped vs. follow-ups

**Shipped — every screen is native (no web redirects):**
- **Send** flow: resolve → quote → method → review → pay QR + live status polling → success.
- **Scan** (expo-camera QR) → routes to Send or a pay-link.
- **Discover**: native merchant directory (`/discover`) with search + category filter.
- **Receive**: your number → Lightning Address + QR (sats settle to Mobile Money).
- **Activity**: this device's payment history (`/payments`, pull-to-refresh).
- **Merchant**: native onboarding + dashboard (verify, sales, payment links, Discover listing).
- **Ambassador**: referral code, stats, native share sheet.
- **Developers**: native API reference (base URL, Lightning Address, endpoints).
- **Claim a refund**: native form (find refundable payments → submit a Lightning invoice).
- **Legal**: Contact is fully native (mail/call via `Linking`); Terms/Privacy render the
  canonical text in-app (fetched, not a browser redirect).
- Brand design system (ported palette + Fredoka/Nunito, elevation), EAS build+submit config,
  branded 1024px icon/splash.

**Follow-ups (documented, not yet built):**
- **Device proof-of-possession signing** (`X-MM-Ts`/`X-MM-Sig`). The web app signs requests
  with a per-device keypair; the native client currently sends the unsigned `X-MM-Sender` id,
  which the backend accepts for never-enrolled ids. Port `app/src/lib/deviceAccount.ts` using
  `expo-crypto` / a native WebCrypto shim to reach parity.
- **Native self-custodial Lightning wallet** (holding sats on-device). The `Receive` tab covers
  getting paid to Mobile Money; an on-device wallet would need a native LN library.
- **Discover map view** (the directory is a native list today) and the **encrypted contacts vault**.
