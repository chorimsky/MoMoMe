/* ============================================================
   Where the native apps live. One place, so the landing page, the smart banner and the
   test page all point at the same links.

   `live` flags: a store listing that is still in review returns "not found", which is a
   worse first impression than a working direct download. While a store is not live the
   Android badge hands out the signed APK and the iOS badge goes to TestFlight (or reads
   "coming soon" when there is no public TestFlight link yet). Flip the flag the day the
   listing is approved.
   ============================================================ */
export const APP_LINKS = {
  play: "https://play.google.com/store/apps/details?id=momome.app",
  appStore: "https://apps.apple.com/app/id6806540524",
  apk: "https://expo.dev/artifacts/eas/PP83lQXP6dZTtqorlEa7Q-D71ucBuoVFdYkaAHae8yw.apk",
  testflight: "",
} as const;

export const STORE_LIVE = { android: false, ios: false } as const;

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
