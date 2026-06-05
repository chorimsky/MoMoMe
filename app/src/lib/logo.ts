/* ============================================================
   Logo image processing — make an uploaded logo display cleanly at the
   intended size on both themes:
   1. Knock out a uniform solid background (usually white) to transparency,
      so it blends with light & dark instead of showing a box.
   2. Trim the surrounding empty padding so the artwork fills the frame —
      otherwise a logo exported with whitespace renders much smaller than the
      built-in wordmark at the same size.
   Transparent logos and photos are handled gracefully (no-ops where unsafe).
   ============================================================ */

type RGB = [number, number, number];

const MAX_WIDTH = 960; // downscale huge exports — keeps the data URL small + crisp
const dist = (a: RGB, b: RGB) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

function draw(img: HTMLImageElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const scale = img.naturalWidth > MAX_WIDTH ? MAX_WIDTH / img.naturalWidth : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx };
}

/** The four corner samples of a drawn canvas. */
function corners(data: Uint8ClampedArray, w: number, h: number): Array<{ rgb: RGB; a: number }> {
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return { rgb: [data[i], data[i + 1], data[i + 2]] as RGB, a: data[i + 3] };
  };
  return [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
}

/** Knock out a uniform solid background (soft-edged) in place. */
function knockoutBackground(image: ImageData): void {
  const { data, width, height } = image;
  const c = corners(data, width, height).map((x) => x.rgb);
  if (!c.every((p) => dist(p, c[0]) < 24)) return; // not a uniform background
  const bg = c[0];
  const tol = 36;
  const soft = tol * 2;
  for (let p = 0; p < data.length; p += 4) {
    const d = dist([data[p], data[p + 1], data[p + 2]], bg);
    if (d <= tol) data[p + 3] = 0;
    else if (d < soft) data[p + 3] = Math.round(((d - tol) / (soft - tol)) * data[p + 3]);
  }
}

interface BBox { x: number; y: number; w: number; h: number; }

/** Bounding box of the actual artwork — ignoring transparent or uniform-colour
 *  background padding. Returns null if nothing distinct is found. */
function contentBox(ctx: CanvasRenderingContext2D, w: number, h: number): BBox | null {
  const { data } = ctx.getImageData(0, 0, w, h);
  const cs = corners(data, w, h);
  const transparentBg = cs.some((c) => c.a < 250);
  const bg = cs[0].rgb;
  let minx = w, miny = h, maxx = -1, maxy = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      const isContent = transparentBg
        ? a > 16
        : a > 16 && dist([data[i], data[i + 1], data[i + 2]], bg) > 24;
      if (isContent) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < minx || maxy < miny) return null;
  return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
}

/** Do the corners look like a single opaque solid colour (a removable
 *  background)? Returns that colour, or null. */
export async function detectSolidBackground(dataUrl: string): Promise<RGB | null> {
  try {
    const img = await loadImage(dataUrl);
    const drawn = draw(img);
    if (!drawn) return null;
    const { ctx, canvas } = drawn;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const cs = corners(data, width, height);
    if (cs.some((c) => c.a < 250)) return null; // already transparent
    const bg = cs[0].rgb;
    if (!cs.every((c) => dist(c.rgb, bg) < 24)) return null; // not uniform
    return bg;
  } catch {
    return null;
  }
}

/** Does this logo need cleanup before it displays well? `solidBg` = sits on a
 *  removable background; `padded` = the artwork is surrounded by enough empty
 *  margin that it would render noticeably small. */
export async function analyzeLogo(dataUrl: string): Promise<{ solidBg: boolean; padded: boolean }> {
  try {
    const img = await loadImage(dataUrl);
    const drawn = draw(img);
    if (!drawn) return { solidBg: false, padded: false };
    const { ctx, canvas } = drawn;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const cs = corners(data, width, height);
    const solidBg = cs.every((c) => c.a >= 250) && cs.every((c) => dist(c.rgb, cs[0].rgb) < 24);
    const box = contentBox(ctx, width, height);
    // Padded if the artwork leaves >12% empty on a side (height or width).
    const padded = !!box && (box.h < height * 0.88 || box.w < width * 0.88);
    return { solidBg, padded };
  } catch {
    return { solidBg: false, padded: false };
  }
}

/** Re-encode a logo: optionally knock out a uniform solid background, trim
 *  surrounding empty padding so the artwork fills the frame, and downscale very
 *  large exports. Returns the original data URL if processing isn't possible. */
export async function processLogo(dataUrl: string, opts: { transparent: boolean; trim?: boolean }): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const drawn = draw(img);
    if (!drawn) return dataUrl;
    let canvas = drawn.canvas;
    let ctx = drawn.ctx;

    if (opts.transparent) {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      knockoutBackground(image);
      ctx.putImageData(image, 0, 0);
    }

    // Trim padding (default on) so the artwork fills the frame and renders at
    // the intended size. A small uniform margin keeps it from looking cramped.
    if (opts.trim !== false) {
      const box = contentBox(ctx, canvas.width, canvas.height);
      if (box && (box.w < canvas.width * 0.96 || box.h < canvas.height * 0.96)) {
        const m = Math.max(2, Math.round(box.h * 0.07));
        const sx = Math.max(0, box.x - m);
        const sy = Math.max(0, box.y - m);
        const cw = Math.min(canvas.width - sx, box.w + 2 * m);
        const ch = Math.min(canvas.height - sy, box.h + 2 * m);
        const out = document.createElement("canvas");
        out.width = cw;
        out.height = ch;
        const octx = out.getContext("2d");
        if (octx) {
          octx.drawImage(canvas, sx, sy, cw, ch, 0, 0, cw, ch);
          canvas = out;
          ctx = octx;
        }
      }
    }
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}
