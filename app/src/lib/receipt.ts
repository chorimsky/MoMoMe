/* ============================================================
   Receipt export — download / share a payment receipt as a branded PNG
   (or text), with no external dependencies. The receipt is composed as an
   SVG (system fonts so it always rasterises) and converted to a PNG via a
   canvas. Share uses the Web Share API with the image file when supported,
   falling back to text share, then clipboard.
   ============================================================ */
import type { Payment } from "@shared/types.js";
import { COUNTRIES } from "@shared/domain.js";
import { fmt } from "./format.js";

export interface ReceiptStrings {
  title: string; deliveredTo: string;
  recipient: string; mobileNumber: string; amountDelivered: string; fee: string; totalPaid: string;
  paidWith: string; amountSent: string; valueUsd: string;
  reference: string; date: string; status: string; completed: string; footer: string;
}

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fullPhone = (p: Payment) => `${COUNTRIES[p.recipient.country].dial} ${p.recipient.phone}`;
const whenStr = (p: Payment) =>
  new Date(p.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** What the sender actually paid: the rail and the crypto amount. Exported so the
 *  on-screen receipt and the downloadable PNG stay identical. */
export const cryptoMethod = (p: Payment): string =>
  p.method === "LIGHTNING" ? "Lightning" : p.method === "ONCHAIN" ? "Bitcoin" : "USDT";
export const cryptoSent = (p: Payment): string => {
  const amt = p.payInstruction?.amount ?? 0;
  if (p.method === "LIGHTNING") return `${fmt(Math.round(amt * 1e8))} sats`; // BTC → sats
  return p.payInstruction?.amountLabel || `${amt} ${p.method === "USDT" ? "USDT" : "BTC"}`;
};
export const usdStr = (p: Payment): string => `≈ $${fmt(p.usd, 2)}`;

/** Plain-text receipt for text share / clipboard fallback. */
export function receiptText(p: Payment, s: ReceiptStrings): string {
  return [
    `MoMo›Me — ${s.title}`,
    `${s.amountDelivered}: ${fmt(p.xaf)} XAF`,
    `${s.deliveredTo} ${p.recipient.name || "—"}`,
    `${s.mobileNumber}: ${fullPhone(p)}`,
    `${s.totalPaid}: ${fmt(p.xaf + p.feeXaf)} XAF`,
    `${s.paidWith}: ${cryptoMethod(p)}`,
    `${s.amountSent}: ${cryptoSent(p)}`,
    `${s.valueUsd}: ${usdStr(p)}`,
    `${s.reference}: ${p.ref}`,
    `${s.date}: ${whenStr(p)}`,
    `${s.status}: ${s.completed}`,
  ].join("\n");
}

/* ---------- SVG composition ---------- */
const FONT = "Arial, Helvetica, system-ui, sans-serif";
const C = { paper: "#efeae0", card: "#ffffff", band: "#fff6d6", ink: "#1c1813", ink2: "#56504a", ink3: "#8b837a", brand: "#f5b800", accent: "#f2660d", green: "#1f9e5a", line: "#ece6da" };

// Header logo region (SVG user units) — where the wordmark sits and where the
// live logo is composited onto the canvas. Centred on the band.
const LOGO_BOX = { x: 208, y: 50, w: 264, h: 64 };

function buildSvg(p: Payment, s: ReceiptStrings): { svg: string; w: number; h: number } {
  const W = 680;
  const rows: Array<[string, string]> = [
    [s.recipient, p.recipient.name || "—"],
    [s.mobileNumber, fullPhone(p)],
    [s.amountDelivered, `${fmt(p.xaf)} XAF`],
    [s.fee, `${fmt(p.feeXaf)} XAF`],
    [s.totalPaid, `${fmt(p.xaf + p.feeXaf)} XAF`],
    [s.paidWith, cryptoMethod(p)],
    [s.amountSent, cryptoSent(p)],
    [s.valueUsd, usdStr(p)],
    [s.reference, p.ref],
    [s.date, whenStr(p)],
  ];
  const cx = W / 2;
  // Brand wordmark geometry: a green lightning bolt centred (nudged right so the
  // longer "MoMo" balances "Me"), with the letters anchored to either side — no
  // text-width math needed, so it centres reliably after rasterisation.
  const boltScale = 0.94;
  const boltW = 23 * boltScale; // bolt glyph natural width (viewBox 0 0 23 50)
  const boltCx = cx + 12;
  const boltLeft = boltCx - boltW / 2;
  const padX = 64, rightX = W - 64;
  const rowsStart = 300, rowH = 50;
  const rowsEnd = rowsStart + rows.length * rowH;
  const statusY = rowsEnd + 36;
  const footerY = statusY + 64;
  const H = footerY + 60;

  const rowSvg = rows.map(([k, v], i) => {
    const y = rowsStart + i * rowH;
    const line = i < rows.length ? `<line x1="${padX}" y1="${y + 16}" x2="${rightX}" y2="${y + 16}" stroke="${C.line}" stroke-width="1"/>` : "";
    return `<text x="${padX}" y="${y}" font-family="${FONT}" font-size="20" fill="${C.ink3}">${esc(k)}</text>
<text x="${rightX}" y="${y}" font-family="${FONT}" font-size="21" font-weight="700" fill="${C.ink}" text-anchor="end">${esc(v)}</text>${line}`;
  }).join("\n");

  const pillW = 150, pillX = rightX - pillW;

  // The built-in MoMo⚡Me wordmark — always rendered; receiptPng paints the live
  // admin-uploaded logo over this region on the canvas when one is set.
  const logoSvg = `<text x="${(boltLeft - 2).toFixed(1)}" y="92" font-family="${FONT}" font-size="42" font-weight="800" letter-spacing="-1.5" text-anchor="end"><tspan fill="${C.brand}">Mo</tspan><tspan fill="${C.accent}">Mo</tspan></text>
<g transform="translate(${boltLeft.toFixed(1)} 54) scale(${boltScale})"><path d="M15.5 1 L2 27 Q1 29 3.5 29 H9.5 L7 47 Q6.8 49.5 9 47.5 L21 22 Q22 20 19.5 20 H13.5 L17.8 3 Q18.4 0.5 15.5 1 Z" fill="${C.green}" stroke="${C.green}" stroke-width="2" stroke-linejoin="round"/></g>
<text x="${(boltLeft + boltW + 2).toFixed(1)}" y="92" font-family="${FONT}" font-size="42" font-weight="800" letter-spacing="-1.5" text-anchor="start"><tspan fill="${C.brand}">M</tspan><tspan fill="${C.accent}">e</tspan></text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${C.paper}"/>
<defs><clipPath id="card"><rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="26"/></clipPath></defs>
<g clip-path="url(#card)">
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="${C.card}"/>
  <rect x="24" y="24" width="${W - 48}" height="248" fill="${C.band}"/>
</g>
<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="26" fill="none" stroke="${C.line}" stroke-width="2"/>
${logoSvg}
<circle cx="${cx}" cy="150" r="27" fill="${C.green}"/>
<path d="M${(cx - 12).toFixed(1)} 150 l 8 9 l 16 -18" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${cx}" y="214" font-family="${FONT}" font-size="20" font-weight="700" fill="${C.ink}" text-anchor="middle">${esc(s.title)}</text>
<text x="${cx}" y="258" font-family="${FONT}" font-size="30" font-weight="800" fill="${C.ink}" text-anchor="middle">${esc(fmt(p.xaf))} <tspan font-size="17" fill="${C.ink3}">XAF</tspan></text>
<line x1="24" y1="272" x2="${W - 24}" y2="272" stroke="${C.line}" stroke-width="2" stroke-dasharray="8 7"/>
${rowSvg}
<text x="${padX}" y="${statusY}" font-family="${FONT}" font-size="20" fill="${C.ink3}">${esc(s.status)}</text>
<rect x="${pillX}" y="${statusY - 22}" width="${pillW}" height="32" rx="16" fill="#e8f5ee"/>
<circle cx="${pillX + 22}" cy="${statusY - 6}" r="5" fill="${C.green}"/>
<text x="${pillX + 38}" y="${statusY}" font-family="${FONT}" font-size="18" font-weight="700" fill="${C.green}">${esc(s.completed)}</text>
<text x="${cx}" y="${footerY}" font-family="${FONT}" font-size="16" fill="${C.ink3}" text-anchor="middle">${esc(s.footer)}</text>
</svg>`;
  return { svg, w: W, h: H };
}

/** Rasterise the receipt SVG to a PNG blob, compositing the live brand logo. */
export function receiptPng(p: Payment, s: ReceiptStrings, logo?: string | null): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const { svg, w, h } = buildSvg(p, s);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w * 2; canvas.height = h * 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) { URL.revokeObjectURL(url); return reject(new Error("no canvas")); }
        ctx.drawImage(img, 0, 0, w * 2, h * 2);
        URL.revokeObjectURL(url);
        const done = () => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
        // Paint the LIVE admin-uploaded logo over the wordmark. Drawn straight to
        // the canvas (raster data URL) so it always rasterises — unlike a nested
        // SVG <image>. On any failure the wordmark stays.
        if (logo && /^data:image\/(png|jpe?g|webp|gif)\b/i.test(logo)) {
          const li = new Image();
          li.onload = () => {
            try {
              const b = LOGO_BOX, sc = 2; // canvas is 2× the SVG units
              ctx.fillStyle = C.band;     // erase the wordmark behind the logo
              ctx.fillRect(b.x * sc, b.y * sc, b.w * sc, b.h * sc);
              const k = Math.min((b.w * sc) / li.naturalWidth, (b.h * sc) / li.naturalHeight);
              const dw = li.naturalWidth * k, dh = li.naturalHeight * k;
              ctx.drawImage(li, b.x * sc + (b.w * sc - dw) / 2, b.y * sc + (b.h * sc - dh) / 2, dw, dh);
            } catch { /* keep the wordmark on any error */ }
            done();
          };
          li.onerror = () => done();
          li.src = logo;
        } else done();
      } catch (e) { URL.revokeObjectURL(url); reject(e instanceof Error ? e : new Error("raster failed")); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("svg load failed")); };
    img.src = url;
  });
}

const fileName = (p: Payment) => `MoMoMe-receipt-${p.ref}.png`;

/** Download the receipt PNG. */
export async function downloadReceipt(p: Payment, s: ReceiptStrings, logo?: string | null): Promise<"ok" | "fail"> {
  try {
    const blob = await receiptPng(p, s, logo);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName(p);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return "ok";
  } catch { return "fail"; }
}

/** Share the receipt — image file if supported, else text, else clipboard. */
export async function shareReceipt(p: Payment, s: ReceiptStrings, logo?: string | null): Promise<"shared" | "copied" | "cancel" | "fail"> {
  const text = receiptText(p, s);
  const nav = navigator as Navigator & { canShare?: (d?: unknown) => boolean };
  // Try sharing the image file.
  try {
    const blob = await receiptPng(p, s, logo);
    const file = new File([blob], fileName(p), { type: "image/png" });
    if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: `MoMo›Me — ${s.title}`, text });
      return "shared";
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return "cancel";
  }
  // Fall back to a plain text share.
  if (typeof nav.share === "function") {
    try { await nav.share({ title: `MoMo›Me — ${s.title}`, text }); return "shared"; }
    catch (e) { if (e instanceof Error && e.name === "AbortError") return "cancel"; }
  }
  // Final fallback: clipboard.
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { return "fail"; }
}
