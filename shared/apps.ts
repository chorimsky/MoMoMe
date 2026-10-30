/* ============================================================
   Where the native apps live. One place, so the landing page, the smart banner and the
   test page all point at the same links.

   `live` flags: a store listing still in review returns "not found", which is a worse
   first impression than a working direct download — so while a store is not live the
   Android badge hands out the signed APK and the iOS badge goes to TestFlight. BOTH ARE
   LIVE NOW (see STORE_LIVE below), so the fallbacks are no longer on the public path.

   The flags have to be flipped the day a listing is approved, and the fallback behind
   them has to stay alive until they are. Neither happened: the flags sat false for weeks
   after approval while both fallbacks rotted, so the badges pointed every visitor at a
   404. If you add a platform here, check the fallback still works the same day.
   ============================================================ */
export const APP_LINKS = {
  play: "https://play.google.com/store/apps/details?id=momome.app",
  appStore: "https://apps.apple.com/app/id6806540524",
  // DEAD as of 30 Oct 2026 (404): EAS build artifacts expire. Kept only because the
  // internal Testing page still offers a direct download; regenerate it with a fresh
  // `eas build` URL before relying on it again. Not used by the public badges any more —
  // STORE_LIVE.android is true, so Android visitors go to Play.
  apk: "https://expo.dev/artifacts/eas/PP83lQXP6dZTtqorlEa7Q-D71ucBuoVFdYkaAHae8yw.apk",
  // Public Beta group. Did not answer when checked on 30 Oct 2026 — superseded by the live
  // App Store listing above, which is where iOS visitors now go. Re-check before pointing
  // anyone at it again.
  testflight: "https://testflight.apple.com/join/6zxsRcHH",
} as const;

/* VERIFIED LIVE 30 October 2026 — both listings fetched and confirmed to be real pages,
   not the soft-404 that Apple and Google both serve with HTTP 200:
     · apps.apple.com/app/id6806540524  → "momome.app App - App Store"
     · play.google.com/…?id=momome.app  → full listing, app description, Data safety

   These flags said `false` long after both listings went live, and that was not a missed
   nicety: while a flag is false the badge hands out the FALLBACK, and both fallbacks had
   rotted — the Expo APK artifact 404s and the TestFlight link does not answer at all. So
   every visitor tapping "get the app" got a dead link while a working store page existed.
   A stale flag here is worse than no flag, because it actively routes people away.

   If a listing is ever pulled, flip the flag back rather than leaving a fallback to rot. */
export const STORE_LIVE = { android: true, ios: true } as const;

export type AppPlatform = "android" | "ios" | "other";

export function platformOf(ua: string): AppPlatform {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "other";
}

/** The best link for a platform today, and whether it is a real store listing. */
export function appLinkFor(platform: AppPlatform): { href: string; store: boolean } | null {
  if (platform === "android") return STORE_LIVE.android ? { href: APP_LINKS.play, store: true } : { href: APP_LINKS.apk, store: false };
  if (platform === "ios") {
    if (STORE_LIVE.ios) return { href: APP_LINKS.appStore, store: true };
    return APP_LINKS.testflight ? { href: APP_LINKS.testflight, store: false } : null;
  }
  return null;
}
