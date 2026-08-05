/* ============================================================
   Per-route SEO for the SPA. The app shell (index.html) is served for every
   client route with a single hard-coded canonical (the home URL), so without
   this every app page (/send, /contact, …) would canonicalize to "/" and never
   index distinctly — and the private consoles (/admin, /ops) would look
   indexable. On each navigation we set the canonical to the current path, mark
   only the known public routes index,follow (everything else — admin, ops, 404
   — noindex,nofollow). The prerendered SEO pages are static HTML (not React
   routes), so their own correct meta is untouched. (Google Search Console
   verification is injected into the static HTML at build time — see vite.config —
   because Google's meta-tag verifier fetches raw HTML and doesn't run JS.)
   ============================================================ */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Public routes that should be indexed (kept in sync with the sitemap). */
const INDEXABLE = new Set(["/", "/send", "/claim", "/contact", "/developers", "/merchant", "/terms", "/privacy"]);

function upsertMeta(name: string, content: string): void {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
  el.setAttribute("content", content);
}
function setCanonical(href: string): void {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) { el = document.createElement("link"); el.setAttribute("rel", "canonical"); document.head.appendChild(el); }
  el.setAttribute("href", href);
}

export function useRouteSeo(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const path = pathname.replace(/\/+$/, "") || "/"; // normalize trailing slash
    const indexable = INDEXABLE.has(path);
    upsertMeta("robots", indexable ? "index,follow,max-image-preview:large" : "noindex,nofollow");
    setCanonical(window.location.origin + (path === "/" ? "/" : path));
  }, [pathname]);
}
