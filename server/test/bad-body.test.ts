/* Malformed request bodies must be 4xx, never 500.

   express.json() calls next(err) on a body it cannot parse. With no handler for that, it
   fell through to the terminal 500 — so a request the CLIENT got wrong was reported as a
   server fault. A TRUNCATED body is the dominant failure mode on 2G/metered data in this
   market, so this surfaced to real users as "Request failed (500)". It also misleads the
   client into retrying an identical bad payload, since 500 reads as "server problem". */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const J = { "content-type": "application/json" };
  const post = (path: string, body: string) => fetch(`${base}${path}`, { method: "POST", headers: J, body });

  try {
    console.log("\nMalformed bodies → 4xx, never 500");
    for (const [label, body] of [
      ["unparseable", "{bad"],
      ["TRUNCATED mid-object (the 2G case)", '{"xaf":1'],
      ["bare null", "null"],
      ["unclosed string", '{"a":"b'],
      ["trailing comma", '{"xaf":1000,}'],
    ] as [string, string][]) {
      const r = await post("/api/quotes", body);
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      ok(`${label} → 400 bad_json`, r.status === 400 && j.error === "bad_json", `${r.status} ${j.error ?? ""}`);
    }

    // Every JSON route, not just quotes — the parser is global.
    for (const ep of ["/api/payments", "/api/admin/login", "/api/merchants/resolve"]) {
      const r = await post(ep, "{bad");
      ok(`${ep} → 400`, r.status === 400, String(r.status));
    }

    // Oversized bodies get their own status rather than a generic failure.
    const r = await post("/api/quotes", JSON.stringify({ pad: "x".repeat(40_000) }));
    ok("over the 32kb cap → 413 payload_too_large", r.status === 413, String(r.status));

    // Valid requests must be completely unaffected.
    const good = await post("/api/quotes", JSON.stringify({ xaf: 10000, method: "LIGHTNING", country: "CM" }));
    ok("a valid body still succeeds", good.status === 200, String(good.status));
    // And a well-formed body with bad VALUES still gets its own domain error, not bad_json.
    const badAmount = await post("/api/quotes", JSON.stringify({ xaf: 1, method: "LIGHTNING", country: "CM" }));
    const ja = (await badAmount.json()) as { error?: string };
    ok("valid JSON, invalid values → domain error (not bad_json)", badAmount.status === 400 && ja.error === "bad_amount", ja.error ?? "");
  } finally { server.close(); }

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
