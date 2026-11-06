/* The real-user monitoring beacon: a PUBLIC, unauthenticated endpoint on a money server.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/rum.test.ts

   WHAT THESE PIN, and why each one is here rather than being obvious:

   core/interop/metrics.ts times our own work — the clock starts when the request lands.
   It cannot see DNS, TLS or the last mile, which is where a user on a Cameroonian mobile
   network spends most of the wait. So the browser reports what only the browser knows.
   That means accepting input from anyone, which brings three ways to get it wrong:

     1. TRUSTING THE BODY'S COUNTRY. If a client could name its own market, one script
        could invent "latency in Nigeria" and an operator would plan against fiction.
        Country must come from the CDN's geo header and nowhere else.
     2. LETTING A PATH BECOME A KEY. Raw paths carry payment ids and reference codes. Used
        as a metrics key they both leak a reference into an operator report and let one
        caller mint unbounded buckets.
     3. COERCING WHAT IT IS SENT. A numeric string, an Infinity, a negative duration or a
        clock-change outlier each move a percentile if clamped rather than dropped.

   And the house rule from stageLatency.ts, which matters most for THIS source: a
   percentile over a handful of samples is noise wearing a number. The first users in a
   new country produce exactly the handful of samples someone would otherwise quote. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "rum-test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { recordRum, rumReport, resetRum, MIN_SAMPLES } = await import("../src/core/rum.js");
  const { createApp } = await import("../src/app.js");

  /* ---------- 1. the unit: validation and bucketing ---------- */
  console.log("\n  a sample is attributed by the CDN header, never by the body\n");
  resetRum();
  recordRum({ path: "/send", ttfb: 400, country: "NG" } as Record<string, unknown>, "CM");
  let rep = rumReport();
  ok("country comes from the header argument", rep.buckets[0]?.country === "CM", rep.buckets[0]?.country);
  ok("a `country` field in the body is ignored", rep.buckets.every((b) => b.country !== "NG"));

  resetRum();
  recordRum({ path: "/send", ttfb: 400 }, undefined);
  ok("no header → '??', not a guess", rumReport().buckets[0]?.country === "??");
  resetRum();
  recordRum({ path: "/send", ttfb: 400 }, "XX");
  ok("a non-ISO header is refused → '??'", rumReport().buckets[0]?.country === "??");
  resetRum();
  recordRum({ path: "/send", ttfb: 400 }, "cm");
  ok("a lowercase header is normalised", rumReport().buckets[0]?.country === "CM");

  console.log("\n  a path is normalised before it can become a key\n");
  resetRum();
  recordRum({ path: "/pay/MMM-2026-123456", ttfb: 100 }, "CM");
  rep = rumReport();
  const route = rep.buckets[0]?.route ?? "";
  ok("a payment reference does not reach the report", !route.includes("MMM-2026-123456"), route);
  ok("it is collapsed to a route class", route.includes(":id"), route);

  resetRum();
  recordRum({ path: "/send?phone=677000000&amount=5000", ttfb: 100 }, "CM");
  rep = rumReport();
  ok("the query string is dropped", !(rep.buckets[0]?.route ?? "").includes("677000000"), rep.buckets[0]?.route);

  resetRum();
  for (let i = 0; i < 400; i++) recordRum({ path: `/x${i}`, ttfb: 10 }, "CM");
  ok("buckets are capped, so paths cannot exhaust memory", rumReport().buckets.length <= 200, `${rumReport().buckets.length}`);

  console.log("\n  hostile and broken numbers are DROPPED, never clamped\n");
  resetRum();
  const junk: Array<[string, unknown]> = [
    ["a numeric string", "400"], ["Infinity", Infinity], ["NaN", NaN],
    ["negative", -5], ["beyond 10 minutes", 600_001], ["null", null],
    ["an object", { v: 1 }], ["an array", [1]], ["a boolean", true],
  ];
  for (const [what, v] of junk) {
    resetRum();
    const accepted = recordRum({ path: "/send", ttfb: v }, "CM");
    ok(`${what} is rejected`, accepted === false, `recordRum → ${accepted}`);
  }
  resetRum();
  ok("a beacon with nothing usable is not counted as a view", recordRum({ path: "/send" }, "CM") === false);
  ok("…and creates no bucket", rumReport().buckets.length === 0);

  resetRum();
  ok("a valid number is accepted", recordRum({ path: "/send", ttfb: 400 }, "CM") === true);
  ok("0 is a legitimate timing, not a falsy miss", recordRum({ path: "/send", ttfb: 0 }, "CM") === true);

  console.log("\n  an unrecognised connection class degrades to 'unknown'\n");
  resetRum();
  recordRum({ path: "/send", ttfb: 1, connection: "6g" }, "CM");
  ok("'6g' → 'unknown'", rumReport().buckets[0]?.connection === "unknown");
  resetRum();
  recordRum({ path: "/send", ttfb: 1, connection: "2g" }, "CM");
  ok("'2g' is kept", rumReport().buckets[0]?.connection === "2g");
  resetRum();
  recordRum({ path: "/send", ttfb: 1, connection: { toString: () => "4g" } }, "CM");
  ok("an object pretending to be a string → 'unknown'", rumReport().buckets[0]?.connection === "unknown");

  console.log(`\n  percentiles are withheld below MIN_SAMPLES (${MIN_SAMPLES})\n`);
  resetRum();
  for (let i = 0; i < MIN_SAMPLES - 1; i++) recordRum({ path: "/send", ttfb: 100 + i }, "CM");
  let b = rumReport().buckets[0];
  ok("below the threshold p50 is null, not 0", b?.metrics.ttfb?.p50 === null, String(b?.metrics.ttfb?.p50));
  ok("…and the sample count is still reported", b?.metrics.ttfb?.samples === MIN_SAMPLES - 1);
  ok("…and a note says why", !!b?.metrics.ttfb?.note);

  recordRum({ path: "/send", ttfb: 999 }, "CM");
  b = rumReport().buckets[0];
  ok("at the threshold a percentile appears", typeof b?.metrics.ttfb?.p50 === "number", String(b?.metrics.ttfb?.p50));
  ok("p95 reflects the slow tail, not the mean", (b?.metrics.ttfb?.p95 ?? 0) >= (b?.metrics.ttfb?.p50 ?? 0));

  console.log("\n  CLS is unitless and kept apart from the millisecond metrics\n");
  resetRum();
  for (let i = 0; i < MIN_SAMPLES; i++) recordRum({ path: "/send", cls: 0.12 }, "CM");
  b = rumReport().buckets[0];
  ok("a CLS-only beacon is a view", b?.views === MIN_SAMPLES);
  ok("CLS keeps its fractional precision", b?.cls.p50 === 0.12, String(b?.cls.p50));
  resetRum();
  ok("a CLS beyond any real score is rejected", recordRum({ path: "/send", cls: 11 }, "CM") === false);

  console.log("\n  the report carries no identifier of any kind\n");
  resetRum();
  recordRum({ path: "/send", ttfb: 1 }, "CM");
  const json = JSON.stringify(rumReport());
  ok("no 'ip' field", !/"ip"/.test(json));
  ok("no user agent", !/user-?agent/i.test(json));
  ok("no id-looking key", !/"(userId|senderId|deviceId|phone)"/.test(json));

  /* ---------- 2. the route ---------- */
  console.log("\n  POST /api/rum\n");
  resetRum();
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/rum`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  let r = await post({ path: "/send", ttfb: 321, connection: "3g" }, { "x-vercel-ip-country": "CM" });
  ok("a good beacon is 204 with no body", r.status === 204, `got ${r.status}`);
  ok("…and was recorded", rumReport().totalViews === 1, `${rumReport().totalViews}`);
  ok("…attributed to the header's country", rumReport().buckets[0]?.country === "CM");

  r = await post([{ path: "/send", ttfb: 1 }], { "x-vercel-ip-country": "CM" });
  ok("an ARRAY body cannot fill a bucket in one request", r.status === 204 && rumReport().totalViews === 1, `views ${rumReport().totalViews}`);

  r = await post({ path: "/send", ttfb: "nonsense" }, { "x-vercel-ip-country": "CM" });
  ok("a rejected sample still answers 204 (no probing signal)", r.status === 204, `got ${r.status}`);
  ok("…and is not counted", rumReport().totalViews === 1, `${rumReport().totalViews}`);

  r = await fetch(`${base}/api/rum`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  ok("malformed JSON is a 4xx, never a 500", r.status >= 400 && r.status < 500, `got ${r.status}`);

  r = await fetch(`${base}/api/rum`, { method: "GET" });
  ok("GET is not a route (beacon is POST-only)", r.status === 404, `got ${r.status}`);

  console.log("\n  the beacon is rate-limited — it is public and unauthenticated\n");
  let limited = 0;
  for (let i = 0; i < 80; i++) {
    const res = await post({ path: "/send", ttfb: 10 }, { "x-vercel-ip-country": "CM" });
    if (res.status === 429) { limited++; break; }
  }
  ok("a flood is throttled with 429", limited > 0);

  await new Promise<void>((r2) => server.close(() => r2()));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
