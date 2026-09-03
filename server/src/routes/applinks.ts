/* ============================================================
   App-link association files — the two documents Apple and Google fetch to decide
   whether momome.xyz links may open the app instead of a browser tab.

   GET /.well-known/apple-app-site-association  → iOS Universal Links
   GET /.well-known/assetlinks.json             → Android App Links

   Served from the SERVER, and reached through a rewrite in the web app's routing, for
   two reasons. The web app is a single-page app whose catch-all returns index.html, so
   these paths were answering with HTML — Apple and Google cannot parse that, which is
   why deep links silently did nothing. And the values are deployment identity
   (Apple Team ID, Android signing certificate fingerprint) that belongs with the rest of
   the deployment's configuration, so supplying them takes an env var rather than a
   rebuild of the mobile app.

   UNSET → 404, never a placeholder. A malformed association file is worse than a missing
   one: the platforms cache what they fetch, so a wrong file can keep links broken long
   after it is corrected, and it looks configured while being useless.
   ============================================================ */
import { Router } from "express";
import type { Request, Response } from "express";
import { config } from "../config.js";

export const applinks = Router();

/** Apple Developer Team ID — 10 alphanumeric characters, e.g. "A1B2C3D4E5". */
export function appleTeamId(): string {
  return (process.env.APPLE_TEAM_ID ?? "").trim().toUpperCase();
}

/** The app's bundle id / Android package. These are compiled into the app, so they are
 *  defaults rather than secrets — overridable for a white-label or staging build. */
export function iosBundleId(): string {
  return (process.env.IOS_BUNDLE_ID ?? "com.momome.app").trim();
}
export function androidPackage(): string {
  return (process.env.ANDROID_PACKAGE ?? "momome.app").trim();
}

/** SHA-256 fingerprints of the Android signing certificates, colon-separated hex.
 *  Accepts several: an app signed by Play App Signing presents Google's certificate,
 *  while a locally-built APK presents the upload key, and BOTH must be listed or links
 *  break for one of them. Comma- or space-separated in the env var. */
export function androidFingerprints(): string[] {
  return (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(/[,\s]+/)
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
}

/** Is a value a real Apple Team ID rather than a placeholder someone pasted? */
export function appleLinksReady(): boolean {
  return /^[A-Z0-9]{10}$/.test(appleTeamId());
}
export function androidLinksReady(): boolean {
  return androidFingerprints().length > 0;
}

/** The path prefixes a link may open in the app. Everything else — the marketing pages,
 *  the admin console — stays in the browser, which is what a person tapping a link to
 *  those actually wants. */
const APP_PATHS = ["/pay/*", "/p/*", "/r/*", "/receive/*"];

applinks.get("/.well-known/apple-app-site-association", (_req: Request, res: Response) => {
  if (!appleLinksReady()) {
    return res.status(404).json({
      error: "not_configured",
      message: "APPLE_TEAM_ID is not set, so iOS Universal Links are not claimed for this deployment.",
    });
  }
  const appID = `${appleTeamId()}.${iosBundleId()}`;
  // Apple requires application/json. It is fetched over HTTPS with no redirects followed,
  // and must not be signed (the signed .pkcs7 form is long deprecated).
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, max-age=3600");
  res.json({
    applinks: { details: [{ appIDs: [appID], components: APP_PATHS.map((p) => ({ "/": p, comment: "payment link" })) }] },
    // Lets the app read/write credentials shared with the site, and is what allows a
    // password manager to offer the same entry for both.
    webcredentials: { apps: [appID] },
  });
});

applinks.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
  const fps = androidFingerprints();
  if (fps.length === 0) {
    return res.status(404).json({
      error: "not_configured",
      message: "ANDROID_CERT_SHA256 is not set, so Android App Links are not claimed for this deployment.",
    });
  }
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, max-age=3600");
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: androidPackage(), sha256_cert_fingerprints: fps },
    },
  ]);
});

/** Readiness detail for the go-live console: what is claimed, and on which host. The
 *  apex/www distinction matters — neither platform follows a redirect when fetching
 *  these, so a deployment whose apex 308s to www must serve them on BOTH hosts. */
export function appLinksStatus(): {
  ios: { ready: boolean; appID: string | null };
  android: { ready: boolean; package: string; fingerprints: number };
  host: string;
} {
  return {
    ios: { ready: appleLinksReady(), appID: appleLinksReady() ? `${appleTeamId()}.${iosBundleId()}` : null },
    android: { ready: androidLinksReady(), package: androidPackage(), fingerprints: androidFingerprints().length },
    host: config.publicUrl,
  };
}
