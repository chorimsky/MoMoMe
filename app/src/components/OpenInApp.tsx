/* "Open in the app" — the app, not the browser, is where a shared pay link should land.

   iOS and Android do this on their own for a VERIFIED link (Universal Links / App Links),
   which is why the association files are served and the app claims /pay and /send. But a
   link tapped inside WhatsApp's or Instagram's own browser, or on a phone whose link
   verification failed, still opens this page. On Android the page can hand the very same
   URL to the installed app through an intent URL, falling back to the download when the
   app is not there. iOS offers no such handoff from a page, so there the Smart App Banner
   (index.html) and the store badge do the inviting. Hidden inside the app's own WebView. */
import { useEffect, useMemo } from "react";
import { appLinkFor, platformOf } from "@shared/apps.js";
import { useI18n } from "../lib/i18n.js";

const ANDROID_PACKAGE = "momome.app";

export function OpenInApp() {
  const { t } = useI18n();
  const href = useMemo(() => {
    if (typeof window === "undefined") return null;
    const ua = navigator.userAgent;
    if (platformOf(ua) !== "android" || /MoMoMeApp/i.test(ua)) return null;
    const u = new URL(window.location.href);
    const fallback = appLinkFor("android")?.href ?? u.href;
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  }, []);
  // iOS: the Smart App Banner opens the app on THIS link when `app-argument` names it —
  // without it the banner opens the app's home and the payment is lost on the way.
  useEffect(() => {
    if (typeof document === "undefined" || platformOf(navigator.userAgent) !== "ios") return;
    const m = document.querySelector<HTMLMetaElement>('meta[name="apple-itunes-app"]');
    if (m) m.content = `app-id=6806540524, app-argument=${window.location.href}`;
  }, []);
  if (!href) return null;
  return (
    <a href={href} className="btn btn-quiet btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start", marginBottom: 10, textDecoration: "none" }}>
      <span aria-hidden>📲</span> {t("open_in_app")}
    </a>
  );
}
