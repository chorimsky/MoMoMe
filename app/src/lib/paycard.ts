/* The "pay me" card: a PNG with the QR, the amount, the number and the link, drawn on a
   canvas. Shared as a FILE where the share sheet takes one (phones), saved as an image
   everywhere else — a shopkeeper prints it, a friend posts it. The link itself already
   previews with its QR (server-rendered Open Graph image); this is the hand-held copy. */
import QRCode from "qrcode";

const C = { paper: "#FAF9F5", card: "#ffffff", ink: "#1a1714", ink2: "#56504a", ink3: "#8b837a", brand: "#FFC92E", line: "#ece6da" };

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
  ctx.fillStyle = C.ink; ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("MoMo›Me", W / 2, H - 60);
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
