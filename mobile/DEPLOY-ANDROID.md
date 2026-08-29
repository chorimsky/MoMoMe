# MoMo›Me — Android / Google Play release

> **Readiness (verified this pass):** `expo-doctor` **18/18**, `tsc --noEmit` clean,
> `expo config` resolves the Android manifest (package, adaptive icon, CAMERA-only
> permission, app-link intent filter), all deps match SDK 54. Store assets generated
> (`store-assets/`). Remaining steps are account-side — the ones **you** must run are
> flagged 👤 (I can't sign in to Google or hold signing secrets).

The app is an Expo (SDK 54) React Native app in `mobile/`, talking to the production
backend at `EXPO_PUBLIC_API_BASE`. Package id: **`com.momome.app`**, version **1.0.0**
(the Android `versionCode` is managed by EAS — `appVersionSource: "remote"` +
`autoIncrement` in `eas.json`, so each production build bumps it automatically).

---

## 0. One-time 👤

| Item | Where | Cost |
|------|-------|------|
| Google Play Console developer account | https://play.google.com/console/signup | $25 once |
| Expo account (for EAS cloud builds) | already logged in as `rimskycho` | free tier OK |

No local Android SDK/Studio is needed — EAS builds in the cloud.

---

## 1. Build the release AAB

Google Play requires an **Android App Bundle (.aab)**. The `production` profile builds
one (`android.buildType: "app-bundle"`) and signs it non-interactively with the **local
upload keystore** (`credentialsSource: "local"` → `credentials/momome.jks`):

```bash
cd mobile && eas build -p android --profile production
```

- No keystore prompt — it uses `credentials.json` / `credentials/momome.jks`. ⚠️ **Back
  that keystore up** (it's gitignored, so it only exists on this machine): it's your Play
  **upload key**. If it's ever lost you can reset the upload key in Play Console, since
  Google holds the real app-signing key (Play App Signing, §4).
- `versionCode` auto-increments on EAS (remote) each build.
- ~10–15 min. The result is a downloadable `.aab` URL — this is what you upload to Play.

Sanity-check locally any time before building:

```bash
cd mobile && npx expo-doctor && npx tsc --noEmit
```

---

## 2. Create the app in Play Console 👤

Play Console → **Create app**: name `MoMo›Me`, default language, **App**, **Free**,
accept the declarations. Then work down the left-nav "Dashboard" checklist below.

---

## 3. Store listing

**Main store listing** → paste:

- **App name** (≤30): `MoMo›Me` (if `›` is rejected, use `MoMoMe — Mobile Money`)
- **Short description** (≤80):
  `Send & receive Mobile Money instantly — pay any MTN or Orange Money number.`
- **Full description** (≤4000): draft in `store-assets/listing.md` (below) — edit to taste.

**Graphics** (all generated in `store-assets/`):
- **App icon** (512×512 PNG): `store-assets/play-icon-512.png` ✅
- **Feature graphic** (1024×500 PNG): `store-assets/play-feature-1024x500.png` ✅
- **Phone screenshots** (2–8, PNG/JPEG): 👤 capture from an Android device/emulator
  (the iOS-sim frames are the wrong chrome and aspect ratio). With a device attached:
  ```bash
  adb exec-out screencap -p > store-assets/screenshots/01.png
  ```
  Good screens to show: Send, the payment success/receipt, Discover, Receive, Contacts.

---

## 4. Signing — Play App Signing

Use **Play App Signing** (the default and recommended). Flow: the **local** keystore
`mobile/credentials/momome.jks` is your **upload key** — the `production` build signs the
AAB with it, and Google re-signs with the app-signing key it holds. On the first upload,
Play Console enrolls this upload certificate automatically. Nothing else to configure.
⚠️ Keep `credentials/momome.jks` + `credentials.json` backed up off this machine (both are
gitignored). If lost, Play Console → App integrity → *Request upload key reset*.

---

## 5. App content declarations 👤 (Dashboard → "Set up your app")

- **Privacy policy**: `https://momome.xyz/privacy` (the app already links to it in-app).
- **Data safety**: see the pre-filled answers in `store-assets/data-safety.md`.
- **Content rating**: complete the questionnaire — it's a finance/payments app, no
  objectionable content; expect **Everyone / PEGI 3**. Declare it handles financial
  transactions.
- **Target audience**: 18+ (a money-transfer app).
- **App access**: *All functionality is available without special access* — the app
  provisions an anonymous device identity automatically; there is **no login/credentials
  gate** a reviewer needs. (The optional "Own your number" OTP just verifies a number.)
- **Ads**: No.
- **Government apps / Financial features**: declare it's a **money transfer / payments**
  app. Google may ask for extra verification for financial products — be ready to
  provide business docs.

---

## 6. Upload & roll out

1. **Testing → Internal testing** → Create release → upload the `.aab` → add testers →
   roll out. Verify install + a real Send end-to-end.
2. When happy: **Production → Create release** → upload the same (or a fresh) AAB →
   staged rollout (e.g. 20%) → review submission.

Or submit from the CLI once a Google service-account JSON is set up:

```bash
cd mobile && eas submit -p android --profile production
```

(`eas.json` already targets the `internal` track for submit; change to `production` when
ready. The service-account key is set up via `eas credentials` / Play Console API access
— that's a 👤 step.)

---

## 7. Deep links (optional but recommended)

The manifest verifies `https://momome.xyz/pay/*` App Links (`autoVerify: true`). For the
verified-link chip to work, host at `https://momome.xyz/.well-known/assetlinks.json` the
SHA-256 of the **app-signing** cert (copy it from Play Console → App signing) for package
`com.momome.app`. Until then, links still open the app via the chooser.

---

## 8. Before you ship — quick checklist

- [ ] `EXPO_PUBLIC_API_BASE` points at the intended prod backend (currently Railway; the
      Vercel cutover just repoints this env var — no rebuild-from-source needed, but a new
      build IS needed to bake the new value).
- [ ] Bump `version` in `app.config.ts` for each public release (`versionCode` auto-bumps).
- [ ] `eas build -p android --profile production` succeeds and the AAB installs.
- [ ] Data safety + content rating + privacy policy submitted.
- [ ] `assetlinks.json` hosted (for verified deep links).
