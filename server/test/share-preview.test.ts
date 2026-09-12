/* Shared pay links preview WITH their QR: crawlers get Open Graph tags whose image is the
   QR of that exact link; the image is a real PNG; bad input goes to the app, not a 500.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/share-preview.test.ts */
process.env.DB_PATH = ":memory:"; process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0); await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    console.log("\nShare previews — the QR travels with the link\n");
    let r = await fetch(`${root}/share/send?to=680344485&amount=500`, { redirect: "manual" });
    const html = await r.text();
    ok("a pay-me link answers HTML for the crawler", r.status === 200 && /text\/html/.test(r.headers.get("content-type") ?? ""));
    ok("title says how much and to which number, no name", /<meta property="og:title" content="Pay 500 XAF to \+237 6 80 34 44 85 · MoMo›Me">/.test(html), html.match(/og:title" content="([^"]+)"/)?.[1]);
    ok("og:image is the QR of that link, country-coded", /og:image" content="[^"]*\/share\/qr\.png\?to=237680344485&amp;amount=500"/.test(html));
    ok("og:url is the canonical country-coded link", /og:url" content="[^"]*\/send\?to=237680344485&amp;amount=500"/.test(html));
    ok("the page is noindex and sends a human on to the app", /noindex/.test(html) && /location\.replace\("[^"]*\/send\?to=237680344485&amount=500"\)/.test(html));
    r = await fetch(`${root}/share/send?to=237680344485`, { redirect: "manual" }); const h2 = await r.text();
    ok("an already country-coded number is not doubled and has no amount", /og:title" content="Pay \+237 6 80 34 44 85 · MoMo›Me"/.test(h2) && !/amount=/.test(h2));
    r = await fetch(`${root}/share/qr.png?to=680344485&amount=500`);
    const buf = Buffer.from(await r.arrayBuffer());
    ok("qr.png is a real PNG, cacheable", r.status === 200 && r.headers.get("content-type") === "image/png" && buf.subarray(1, 4).toString() === "PNG" && buf.length > 1000 && /max-age/.test(r.headers.get("cache-control") ?? ""), `${buf.length} bytes`);
    r = await fetch(`${root}/share/send?to=12`, { redirect: "manual" });
    ok("a bad number sends the crawler to the plain send page (302), never a 500", r.status === 302 && /\/send$/.test(r.headers.get("location") ?? ""));
    r = await fetch(`${root}/share/qr.png?to=12`);
    ok("…and no QR is drawn for it (404)", r.status === 404);
    r = await fetch(`${root}/share/pay/NOPE-000`, { redirect: "manual" });
    ok("an unknown business link goes to its page on the app (302)", r.status === 302 && /\/pay\/NOPE-000$/.test(r.headers.get("location") ?? ""));
    ok("no personal name appears anywhere in a preview", !/displayName|nameVerified/.test(html));
  } finally { server.close(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`); process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
