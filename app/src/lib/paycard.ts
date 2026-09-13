/* The "pay me" card: a PNG with the QR, the amount, the number and the link, drawn on a
   canvas. Shared as a FILE where the share sheet takes one (phones), saved as an image
   everywhere else — a shopkeeper prints it, a friend posts it. The link itself already
   previews with its QR (server-rendered Open Graph image); this is the hand-held copy. */
import QRCode from "qrcode";

const C = { paper: "#FAF9F5", card: "#ffffff", ink: "#1a1714", ink2: "#56504a", ink3: "#8b837a", brand: "#FFC92E", line: "#ece6da" };

import { brandLogoNow } from "../components/atoms.js";

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export interface PayCard { link: string; who: string; amountLabel?: string; headline: string; footnote: string }

export async function payCardPng(c: PayCard): Promise<Blob> {
  const W = 1080, H = 1350, S = 2; // 4:5 — the shape every chat and feed shows whole
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"); if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.brand; ctx.fillRect(0, 0, W, 18 * S);
  // Card
  ctx.fillStyle = C.card; rr(ctx, 60, 90, W - 120, H - 180, 40); ctx.fill();
  ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink; ctx.font = "800 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(c.headline, W / 2, 200);
  if (c.amountLabel) { ctx.font = "800 88px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"; ctx.fillText(c.amountLabel, W / 2, 320); }
  // QR
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, c.link, { width: 640, margin: 2, errorCorrectionLevel: "M", color: { dark: C.ink, light: C.card } });
  const qy = c.amountLabel ? 380 : 280;
  ctx.drawImage(qr, (W - 640) / 2, qy, 640, 640);
  ctx.fillStyle = C.ink; ctx.font = "700 48px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(c.who, W / 2, qy + 640 + 90);
  ctx.fillStyle = C.ink2; ctx.font = "500 32px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(c.link.replace(/^https?:\/\//, ""), W / 2, qy + 640 + 150);
  ctx.fillStyle = C.ink3; ctx.font = "500 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(c.footnote, W / 2, H - 130);
  // The brand at the foot of the card: the operator's uploaded logo when there is one,
  // otherwise the wordmark in its own face with the green bolt — never a plain-text stand-in.
  await drawBrand(ctx, W / 2, H - 60);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}

const fileName = (who: string) => `momome-pay-${who.replace(/\D/g, "")}.png`;

export async function downloadPayCard(c: PayCard): Promise<"ok" | "fail"> {
  try {
    const url = URL.createObjectURL(await payCardPng(c));
    const a = document.createElement("a"); a.href = url; a.download = fileName(c.who);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return "ok";
  } catch { return "fail"; }
}

/** Share the link WITH its QR: file + text + url where the sheet accepts files (phones),
 *  text + url elsewhere (the link previews with the QR anyway), then WhatsApp web as the
 *  last resort. Never puts the link in both `text` and `url` — that showed it twice. */
export async function sharePayCard(c: PayCard, text: string): Promise<"shared" | "whatsapp" | "cancel"> {
  const nav = navigator as Navigator & { canShare?: (d?: unknown) => boolean };
  if (typeof nav.share === "function") {
    try {
      const file = new File([await payCardPng(c)], fileName(c.who), { type: "image/png" });
      if (nav.canShare?.({ files: [file], text, url: c.link })) { await nav.share({ files: [file], text, url: c.link }); return "shared"; }
      if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text: `${text}\n${c.link}` }); return "shared"; }
    } catch (e) { if (e instanceof Error && e.name === "AbortError") return "cancel"; }
    try { await nav.share({ title: "MoMo›Me", text, url: c.link }); return "shared"; }
    catch (e) { if (e instanceof Error && e.name === "AbortError") return "cancel"; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${c.link}`)}`, "_blank", "noopener");
  return "whatsapp";
}

const BOLT = new Path2D("M15.5 1 L2 27 Q1 29 3.5 29 H9.5 L7 47 Q6.8 49.5 9 47.5 L21 22 Q22 20 19.5 20 H13.5 L17.8 3 Q18.4 0.5 15.5 1 Z");
async function drawBrand(ctx: CanvasRenderingContext2D, cx: number, baseline: number): Promise<void> {
  const logo = brandLogoNow();
  if (logo) {
    const img = await new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = logo; });
    if (img && img.naturalHeight) { const h = 56; const w = Math.min(320, img.naturalWidth * (h / img.naturalHeight)); ctx.drawImage(img, cx - w / 2, baseline - h + 8, w, h); return; }
  }
  try { await document.fonts.load('400 40px "Bagel Fat One"'); } catch { /* fallback face */ }
  const face = document.fonts.check('400 40px "Bagel Fat One"') ? '"Bagel Fat One"' : "system-ui, sans-serif";
  ctx.font = `400 44px ${face}`; ctx.textBaseline = "alphabetic";
  const parts: Array<[string, string]> = [["Mo", "#FFC92E"], ["Mo", "#EA6A28"], ["⚡", ""], ["Me", "#EA6A28"]];
  const boltW = 22; const total = parts.reduce((a, [t]) => a + (t === "⚡" ? boltW : ctx.measureText(t).width), 0);
  let x = cx - total / 2;
  ctx.textAlign = "left";
  for (const [t, color] of parts) {
    if (t === "⚡") { ctx.save(); ctx.translate(x, baseline - 34); ctx.scale(boltW / 23, 36 / 50); ctx.fillStyle = "#1FA971"; ctx.fill(BOLT); ctx.restore(); x += boltW; continue; }
    ctx.fillStyle = color; ctx.fillText(t, x, baseline); x += ctx.measureText(t).width;
  }
  ctx.textAlign = "center";
}
