/* ============================================================
   Store badges + the "get the app" banner. Every visitor is nudged to the native app:
   the hero shows both badges, phones get a sticky bottom banner that deep-links to the
   store for their platform, and the footer repeats the badges.

   Badges are inline SVG (no image requests, theme-safe) shaped like the official ones:
   dark pill, store glyph, small "GET IT ON" / "Download on the" line, big store name.
   ============================================================ */
import { useEffect, useState } from "react";
import { APP_LINKS, STORE_LIVE, appLinkFor, platformOf } from "@shared/apps.js";
import { track } from "../lib/analytics.js";
import { useI18n } from "../lib/i18n.js";

function PlayGlyph() {
  return (
    <svg width="26" height="28" viewBox="0 0 24 26" aria-hidden="true">
      <path d="M1.5 1.2 13.6 13 1.5 24.8c-.3-.3-.5-.8-.5-1.4V2.6c0-.6.2-1.1.5-1.4z" fill="#32bbff" />
      <path d="M17.6 9.1 13.6 13l-12.1 11.8c.5.5 1.3.6 2 .2l14.1-8.1z" fill="#f43249" />
      <path d="M17.6 9.1 3.5 1c-.7-.4-1.5-.3-2 .2L13.6 13z" fill="#00d269" />
      <path d="m17.6 9.1 4.6 2.6c1.1.6 1.1 1.9 0 2.6l-4.6 2.6L13.6 13z" fill="#ffd500" />
    </svg>
  );
}
function AppleGlyph() {
  return (
    <svg width="24" height="28" viewBox="0 0 24 28" aria-hidden="true" fill="currentColor">
      <path d="M19.6 14.9c0-3 2.5-4.5 2.6-4.6-1.4-2.1-3.6-2.4-4.4-2.4-1.9-.2-3.7 1.1-4.6 1.1-1 0-2.4-1.1-4-1.1-2 0-3.9 1.2-5 3-2.1 3.7-.5 9.2 1.5 12.2 1 1.5 2.2 3.1 3.8 3.1 1.5-.1 2.1-1 3.9-1s2.4 1 4 .9c1.6 0 2.7-1.5 3.7-3 1.2-1.7 1.6-3.3 1.7-3.4-.1 0-3.2-1.2-3.2-4.8zM16.6 5.9c.8-1 1.4-2.4 1.2-3.8-1.2.1-2.7.8-3.5 1.8-.8.9-1.5 2.3-1.3 3.7 1.4.1 2.7-.7 3.6-1.7z" />
    </svg>
  );
}

const badge: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 10, height: 52, padding: "0 16px 0 12px",
  borderRadius: 12, background: "#111", color: "#fff", textDecoration: "none", border: "1px solid #333",
  lineHeight: 1.05, whiteSpace: "nowrap", boxShadow: "var(--shadow-sm)",
};

function Badge({ href, glyph, small, big, muted }: { href: string | null; glyph: React.ReactNode; small: string; big: string; muted?: boolean }) {
  const inner = (
    <>
      {glyph}
      <span style={{ display: "grid" }}>
        <span style={{ fontSize: 10, letterSpacing: ".04em", opacity: .85, textTransform: "uppercase" }}>{small}</span>
        <span style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}>{big}</span>
      </span>
    </>
  );
  if (!href) return <span style={{ ...badge, opacity: .55, cursor: "default" }} aria-disabled="true">{inner}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => track("get_app", { store: /play\.google|apple\.com|testflight/.test(href) ? (href.includes("google") ? "play" : "apple") : "apk" })} style={{ ...badge, ...(muted ? { opacity: .92 } : null) }}>{inner}</a>;
}

/** Both badges. Android falls back to the APK while the Play listing is in review; iOS to
    TestFlight (or "coming soon") until the App Store listing is live. */
export function StoreBadges({ align = "flex-start" }: { align?: "flex-start" | "center" }) {
  const { t } = useI18n();
  const android = appLinkFor("android");
  const ios = appLinkFor("ios");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: align }}>
      <Badge href={android?.href ?? null} glyph={<PlayGlyph />}
        small={STORE_LIVE.android ? t("app_get_it_on") : t("app_direct_download")}
        big={STORE_LIVE.android ? "Google Play" : "Android (APK)"} />
      <Badge href={ios?.href ?? null} glyph={<AppleGlyph />}
        small={STORE_LIVE.ios ? t("app_download_on") : ios ? "TestFlight" : t("app_coming_soon")}
        big="App Store" />
    </div>
  );
}

const DISMISS_KEY = "momome.appbanner.dismissed";

/** Sticky bottom banner on phones: one tap to the right store. Hidden inside the native
    app's web views, on desktop, and for a week after the visitor closes it. */
export function AppBanner() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const platform = typeof navigator === "undefined" ? "other" : platformOf(navigator.userAgent);
  const link = appLinkFor(platform);
  useEffect(() => {
    if (platform === "other" || !link) return;
    try {
      const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (until > Date.now()) return;
    } catch { /* storage blocked: still show */ }
    const standalone = (window.matchMedia?.("(display-mode: standalone)").matches) || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return; // already installed as a PWA — do not nag
    setShow(true);
  }, [platform, link]);
  if (!show || !link) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 864e5)); } catch { /* ignore */ } setShow(false); };
  return (
    <div role="complementary" aria-label={t("app_banner_title")} style={{
      position: "fixed", left: 12, right: 12, bottom: "max(12px, env(safe-area-inset-bottom))", zIndex: 60,
      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 16,
      background: "var(--surface)", border: "1px solid var(--line)", boxShadow: "0 12px 40px oklch(0.3 0.03 64 / 0.22)",
    }}>
      <img src="/icon-192.png" alt="" width={44} height={44} style={{ borderRadius: 11, flex: "none" }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t("app_banner_title")}</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {platform === "ios" ? (link.store ? "App Store" : "TestFlight") : (link.store ? "Google Play" : t("app_direct_download_lc"))} · {t("app_banner_sub")}
        </div>
      </div>
      <a className="btn btn-primary btn-sm" href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => track("get_app", { store: "banner" })} style={{ textDecoration: "none", flex: "none" }}>{t("app_banner_cta")}</a>
      <button type="button" onClick={dismiss} aria-label={t("app_banner_close")}
        style={{ flex: "none", width: 28, height: 28, borderRadius: "50%", border: "none", background: "transparent", color: "var(--ink-3)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
    </div>
  );
}

export { APP_LINKS };
