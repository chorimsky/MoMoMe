/* Every call the web app makes must reach a route that exists.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/client-routes-exist.test.ts

   Nothing checked this. client-backend-wiring.test.ts verifies WHICH backend the clients
   point at — a real problem, and a different one. It does not check that each path the
   client calls is registered, so a renamed or removed route leaves a button in the console
   or the app that returns 404 at the moment someone needs it, and no test notices: the
   server is fine, the client compiles, and the two simply disagree.

   This reads the shipped client and the shipped router and compares them. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "client-routes-test";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

/** "/admin/users/${id}" → "/admin/users/:x"; drop any query string. */
function normalise(p: string): string {
  // ${...} may nest one level (a ternary with an object/template inside).
  // A ${...} may contain a NESTED template literal with its own braces and backticks
  // (`/admin/reports${p ? `?period=${p}` : ""}`), which no single regex untangles. Scan
  // instead, tracking brace depth, and replace each whole expression with :x.
  //
  // The first attempt simply cut the path at the first ${ and compared prefixes. That
  // passed — and checked almost nothing: "/payments/${id}/confirm" became "/payments/",
  // which matches "/payments/:id" while never verifying that /confirm exists at all.
  let out = "";
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "$" && p[i + 1] === "{") {
      let depth = 1; i += 2;
      while (i < p.length && depth > 0) { if (p[i] === "{") depth++; else if (p[i] === "}") depth--; i++; }
      i--;                       // the for-loop's i++ consumes the closing brace
      out += ":x";
    } else out += p[i];
  }
  return out.replace(/\?.*$/, "").replace(/\/+$/, "") || "/";
}
/** An Express path with :params → a regex that matches a normalised client path. */
function toRe(expressPath: string): RegExp {
  const src = expressPath
    .replace(/\/+$/, "")
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${src || "/"}$`);
}

async function main() {
  const { api } = await import("../src/routes/api.js");
  const { v1 } = await import("../src/routes/v1.js");

  // Walk MOUNTED SUB-ROUTERS too. The first version read only the two top-level stacks and
  // reported every /admin/network, /admin/platform, /network and /v2/identity route as
  // missing — they are real, they just live behind api.use(). A completeness check that
  // does not see half the routes reports absence where it has simply not looked.
  const registered: string[] = [];
  const mountOf = (re: RegExp): string => {
    // Express compiles a mount path to /^\/admin\/?(?=\/|$)/i — recover "/admin".
    const m = /^\^\\\/(.*?)\\\/\?/.exec(re.source);
    return m ? "/" + m[1].replace(/\\\//g, "/").replace(/\\/g, "") : "";
  };
  const walk = (router: unknown, prefix: string, depth = 0): void => {
    if (depth > 4) return;
    for (const l of ((router as { stack?: Array<Layer & { regexp?: RegExp; handle?: unknown; name?: string }> }).stack ?? [])) {
      if (l.route?.path) { registered.push(prefix + l.route.path); continue; }
      const nested = (l.handle as { stack?: unknown[] } | undefined)?.stack;
      if (Array.isArray(nested) && l.regexp) walk(l.handle, prefix + mountOf(l.regexp), depth + 1);
    }
  };
  walk(api, "");
  walk(v1, "/v1");
  // Mounted on the APP, not on `api` — app.use("/api/network"), app.use("/api/v2/identity"),
  // app.use("/api/v2"). The client calls them through the same /api prefix, so they are the
  // same surface from its point of view and belong in the comparison.
  const { network } = await import("../src/routes/network.js");
  const { identityV2 } = await import("../src/routes/identityV2.js");
  const { upi } = await import("../src/routes/upi.js");
  walk(network, "/network");
  walk(identityV2, "/v2/identity");
  walk(upi, "/v2");
  const res = registered.map(toRe);

  const src = readFileSync(new URL("../../app/src/api/client.ts", import.meta.url), "utf8");
  // Both quoted and template-literal forms, with or without a type parameter.
  const found = new Set<string>();
  // A template literal may contain quotes INSIDE ${...} — `/x${q ? "a" : ""}` — so a lazy
  // [^"\'`]* stops early and yields a truncated path like "/admin/reports${period".
  // Take everything to the closing delimiter of the same kind instead.
  for (const m of src.matchAll(/req(?:<[^>]*>)?\(\s*"((?:\/)[^"]*)"/g)) found.add(normalise(m[1]));
  for (const m of src.matchAll(/req(?:<[^>]*>)?\(\s*`((?:\/)(?:[^`\\]|\\.)*)`/g)) found.add(normalise(m[1]));
  const paths = [...found].sort();

  console.log(`\n${registered.length} registered routes · ${paths.length} distinct paths called by the web app\n`);
  ok("the client was parsed", paths.length > 50, `${paths.length} paths`);
  ok("the routers were read", registered.length > 100, `${registered.length} routes`);

  console.log("\nEvery path the client calls is registered\n");
  // A client path whose dynamic tail was cut matches either the exact route or a route
  // that continues with a parameter: "/admin/reports" matches "/admin/reports", and
  // "/payments/" (from `/payments/${id}`) matches "/payments/:id".
  // A ${...} glued to the end of a segment with no "/" before it builds a QUERY STRING
  // (`/admin/reports${p ? `?period=${p}` : ""}`), not another path segment. Try the path
  // without that trailing placeholder as well. Placeholders that ARE their own segment
  // ("/payments/:x/confirm") keep being matched strictly, so /confirm is still verified.
  const candidates = (p: string): string[] => (/[^/]:x$/.test(p) ? [p, p.replace(/:x$/, "")] : [p]);
  const missing = paths.filter((p) => !candidates(p).some((c) => res.some((re) => re.test(c))));
  ok("no client call points at a route that does not exist",
    missing.length === 0,
    missing.length ? missing.join("  |  ") : `all ${paths.length} resolve`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
