/* ============================================================
   Logo image processing — make an uploaded logo blend seamlessly with the
   light/dark theme. Raster logos are usually exported on a solid (white)
   background; on a dark theme that shows as an ugly box. We detect a uniform
   solid background and knock it out to transparency, so the theme shows through
   on both light and dark. Transparent logos and photos are left untouched.
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

/** Do the corners look like a single opaque solid colour (i.e. a background
 *  worth removing)? Returns that colour, or null if the logo is already
 *  transparent / has no uniform background. */
export async function detectSolidBackground(dataUrl: string): Promise<RGB | null> {
  try {
    const img = await loadImage(dataUrl);
    const drawn = draw(img);
    if (!drawn) return null;
    const { ctx, canvas } = drawn;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const at = (x: number, y: number): { rgb: RGB; a: number } => {
      const i = (y * width + x) * 4;
      return { rgb: [data[i], data[i + 1], data[i + 2]], a: data[i + 3] };
    };
    const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
    // Already has transparent corners → nothing to remove.
    if (corners.some((c) => c.a < 250)) return null;
    // Corners must agree (a real solid background, not a photo).
    const bg = corners[0].rgb;
    if (!corners.every((c) => dist(c.rgb, bg) < 24)) return null;
    return bg;
  } catch {
    return null;
  }
}

/** Re-encode a logo: optionally knock out a uniform solid background to
 *  transparency (soft-edged), and downscale very large exports. Returns the
 *  original data URL unchanged if processing isn't possible. */
export async function processLogo(dataUrl: string, opts: { transparent: boolean }): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const drawn = draw(img);
    if (!drawn) return dataUrl;
    const { canvas, ctx } = drawn;

    if (opts.transparent) {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = image;
      const corner = (x: number, y: number): RGB => {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const c = [corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1)];
      const uniform = c.every((p) => dist(p, c[0]) < 24);
      if (uniform) {
        const bg = c[0];
        const tol = 36; // fully transparent within this distance of the bg
        const soft = tol * 2; // feather edge up to here
        for (let p = 0; p < data.length; p += 4) {
          const d = dist([data[p], data[p + 1], data[p + 2]], bg);
          if (d <= tol) data[p + 3] = 0;
          else if (d < soft) data[p + 3] = Math.round(((d - tol) / (soft - tol)) * data[p + 3]);
        }
        ctx.putImageData(image, 0, 0);
      }
    }
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}
