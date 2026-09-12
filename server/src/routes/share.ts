/* ============================================================
   Share previews — the QR travels WITH the link.

   A "pay me" link is pasted into WhatsApp, iMessage, Telegram, a Facebook group. Those apps
   fetch the URL once with their crawler and show whatever Open Graph tags they find. The
   web app is a single-page bundle, so a crawler saw nothing. Vercel now routes crawler
   user-agents for /send and /pay/:code here; humans still get the app.

   What the crawler gets: a title that says who is paid and how much, a one-line description
   in the product's own words, and an og:image that IS the QR code of that very link. So
   every shared link shows its QR inline, on every platform, with no image attached by hand
   and no native module in the app. The QR is rendered here (pure JS, cached by the CDN).

   No names are revealed: the preview shows the number, never the identity behind it.
   ============================================================ */
import { Router } from "express";
import type { Request, Response } from "express";
import QRCode from "qrcode";
import { config } from "../config.js";
import { COUNTRIES, MAX_XAF, receiveLink, splitDialed, checkPhone } from "../../../shared/domain.js";
import { getLink, merchantById } from "../core/merchantAccount.js";

export const share = Router();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/ /g, " ");
const groupLocal = (local: string) => local.replace(/(\d)(?=(\d{2})+$)/g, "$1 ").trim();

function parseTo(q: Request["query"]): { country: keyof typeof COUNTRIES; local: string; dialed: string } | null {
  const to = typeof q.to === "string" ? q.to.replace(/\D/g, "") : "";
  if (to.length < 8 || to.length > 12) return null;
  const { country, local } = splitDialed(to, "CM");
  if (!checkPhone(local, country).ok) return null;
  return { country, local, dialed: `${COUNTRIES[country].dial.replace(/\D/g, "")}${local}` };
}
const parseAmount = (q: Request["query"]) => { const a = Number(String(typeof q.amount === "string" ? q.amount : "").replace(/\D/g, "")); return a > 0 && a <= MAX_XAF ? Math.round(a) : 0; };

function page(res: Response, o: { title: string; description: string; url: string; image: string; canonical: string }): void {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300, s-maxage=3600");
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MoMo›Me">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.canonical)}">
<meta property="og:image" content="${esc(o.image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="640"><meta property="og:image:height" content="640">
<meta property="og:image:alt" content="QR code — scan to pay with MoMo›Me">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
<meta name="twitter:image" content="${esc(o.image)}">
<meta name="robots" content="noindex">
<script>location.replace(${JSON.stringify(o.url)})</script>
</head><body style="font-family:system-ui;margin:40px;text-align:center">
<p><a href="${esc(o.url)}">Open MoMo›Me to pay</a></p>
<img src="${esc(o.image)}" width="320" height="320" alt="QR code">
</body></html>`);
}

async function qrPng(res: Response, text: string): Promise<void> {
  // 640 px, quiet zone of 4 modules, the brand's ink on its paper. Cached hard: the same
  // link always yields the same image.
  const buf = await QRCode.toBuffer(text, { type: "png", width: 640, margin: 4, errorCorrectionLevel: "M", color: { dark: "#1a1a1a", light: "#FAF9F5" } });
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "public, max-age=86400, s-maxage=604800, immutable");
  res.send(buf);
}

/* ---- personal "pay me" link: /send?to=…&amount=… ---- */
share.get("/share/send", (req, res) => {
  const to = parseTo(req.query);
  if (!to) { res.redirect(302, `${config.webOrigin}/send`); return; }
  const amount = parseAmount(req.query);
  const url = receiveLink(config.webOrigin, to.dialed, amount || undefined, to.country);
  const who = `${COUNTRIES[to.country].dial} ${groupLocal(to.local)}`;
  page(res, {
    title: amount ? `Pay ${fmt(amount)} XAF to ${who} · MoMo›Me` : `Pay ${who} · MoMo›Me`,
    description: `Scan the code or open the link. The money lands on ${who}'s Mobile Money in seconds. Mobile Money, made simple.`,
    url, canonical: url,
    image: `${config.webOrigin}/share/qr.png?to=${to.dialed}${amount ? `&amount=${amount}` : ""}`,
  });
});
share.get("/share/qr.png", async (req, res) => {
  const to = parseTo(req.query);
  if (!to) { res.status(404).end(); return; }
  const amount = parseAmount(req.query);
  await qrPng(res, receiveLink(config.webOrigin, to.dialed, amount || undefined, to.country));
});

/* ---- business link: /pay/:code ---- */
share.get("/share/pay/:code", (req, res) => {
  const code = String(req.params.code).slice(0, 40);
  const url = `${config.webOrigin}/pay/${encodeURIComponent(code)}`;
  const link = getLink(code);
  const m = link && !link.disabledAt ? merchantById(link.merchantId) : undefined;
  if (!link || !m || m.status !== "active") { res.redirect(302, url); return; }
  const amt = link.amountXaf && link.amountXaf > 0 ? `${fmt(link.amountXaf)} XAF` : null;
  page(res, {
    title: amt ? `Pay ${amt} to ${m.businessName} · MoMo›Me` : `Pay ${m.businessName} · MoMo›Me`,
    description: `${link.label ? `${link.label}. ` : ""}Scan the code or open the link to pay ${m.businessName} with Mobile Money. Mobile Money, made simple.`,
    url, canonical: url,
    image: `${config.webOrigin}/share/pay/${encodeURIComponent(code)}/qr.png`,
  });
});
share.get("/share/pay/:code/qr.png", async (req, res) => {
  const code = String(req.params.code).slice(0, 40);
  const link = getLink(code);
  if (!link || link.disabledAt) { res.status(404).end(); return; }
  await qrPng(res, `${config.webOrigin}/pay/${encodeURIComponent(code)}`);
});
