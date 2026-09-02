/* ============================================================
   Per-route document title.

   Titles used to be set by five individual pages in their own useEffect, and none of them
   restored anything on unmount. So the title was whatever the last title-setting page had
   written: navigating /developers → /ambassador left "MoMo›Me API — Developer
   documentation" sitting on the ambassador page, and nine routes never set a title at all
   and simply inherited whatever came before. Browser tabs, history entries and bookmarks
   all recorded the wrong page.

   One owner, applied on every navigation, fixes both halves: a route that has a title gets
   it, and a route that doesn't falls back to the site title rather than keeping a stale one.
   ============================================================ */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "./i18n.js";

/** Matches app/index.html, so returning to the landing page restores the original title
 *  rather than leaving a route title behind. */
const SITE = "MoMo›Me — Pay Mobile Money Instantly with Bitcoin, Lightning & USDT";
const SITE_FR = "MoMo›Me — Payez le Mobile Money instantanément avec Bitcoin, Lightning et USDT";

/** Exact-path titles. Prefix routes (/pay/:code, /m/:code) are handled below. */
const TITLES: Record<string, [en: string, fr: string]> = {
  "/": [SITE, SITE_FR],
  "/send": ["Send Mobile Money · MoMo›Me", "Envoyer du Mobile Money · MoMo›Me"],
  "/receive": ["Get paid in Mobile Money · MoMo›Me", "Être payé en Mobile Money · MoMo›Me"],
  "/claim": ["Claim your account · MoMo›Me", "Activez votre compte · MoMo›Me"],
  "/scan": ["Scan to pay · MoMo›Me", "Scanner pour payer · MoMo›Me"],
  "/discover": ["Find businesses · MoMo›Me", "Trouver des commerces · MoMo›Me"],
  "/merchant": ["Accept payments · MoMo›Me", "Accepter les paiements · MoMo›Me"],
  "/diaspora": ["Send money home · MoMo›Me", "Envoyer de l'argent au pays · MoMo›Me"],
  "/ambassador": ["Ambassador programme · MoMo›Me", "Programme ambassadeur · MoMo›Me"],
  "/developers": ["MoMo›Me API — Developer documentation", "API MoMo›Me — Documentation développeur"],
  "/contact": ["Contact & support · MoMo›Me", "Contact & assistance · MoMo›Me"],
  "/terms": ["Terms of Service · MoMo›Me", "Conditions d'utilisation · MoMo›Me"],
  "/privacy": ["Privacy Policy · MoMo›Me", "Politique de confidentialité · MoMo›Me"],
  "/admin": ["Operator console · MoMo›Me", "Console opérateur · MoMo›Me"],
  "/ops": ["Operations · MoMo›Me", "Opérations · MoMo›Me"],
};

function titleFor(pathname: string, fr: boolean): string {
  const exact = TITLES[pathname];
  if (exact) return exact[fr ? 1 : 0];
  // A merchant checkout link. The business name isn't known until the link resolves, so
  // this is the honest generic — better than inheriting the previous page's title.
  if (pathname.startsWith("/pay/") || pathname.startsWith("/m/")) {
    return fr ? "Payer · MoMo›Me" : "Pay · MoMo›Me";
  }
  // Every real route is listed above (the router has no other dynamic paths), so anything
  // left really is the catch-all 404 — and naming it as such is what stops an unknown URL
  // from wearing the site title in the tab and in history.
  return fr ? "Page introuvable · MoMo›Me" : "Page not found · MoMo›Me";
}

/** Mounted once inside the router; owns document.title for every route. */
export function RouteTitle() {
  const { pathname } = useLocation();
  const { lang } = useI18n();
  useEffect(() => { document.title = titleFor(pathname, lang === "fr"); }, [pathname, lang]);
  return null;
}
