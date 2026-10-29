/* EVERY admin route must be reachable by someone. Not a sample of them.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/admin-coverage.test.ts

   The /admin guard fails closed: sectionForPath() returning null means 403, to a Super
   Admin included. That is the right default and it has gone wrong twice — /admin/methods
   and /admin/deletion-requests both went dark because a route was added and never mapped.

   admin-sections.test.ts guards this by calling ONE representative GET per prefix. That
   catches a whole prefix going dark; it cannot catch a single unmapped route, and it does
   not look at POST, PUT, PATCH or DELETE at all — which is most of what an operator
   actually does: approving, suspending, refunding, crediting.

   This enumerates every registered admin route of every method and checks the mapping
   directly. sectionForPath is a pure lookup, so nothing is invoked and no money moves. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "admin-coverage-test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

async function main() {
  const { api, sectionForPath } = await import("../src/routes/api.js");
  const { ADMIN_ROLES, canAccess } = await import("../../shared/roles.js");

  // Express runs layers in REGISTRATION order, so a route registered before the /admin
  // guard never reaches it — that is how the login flow works, and it is also how an admin
  // route could accidentally ship with no authentication at all. Split on the guard's
  // position and hold the two halves to different standards.
  const stack = (api as unknown as { stack: Array<Layer & { name?: string; regexp?: RegExp }> }).stack;
  // Match the /admin guard SPECIFICALLY. Testing `regexp.test("/admin/x")` finds the first
  // catch-all middleware instead (express.json's regexp matches everything), which put the
  // split at index 0 and made the "before the guard" assertion pass with an empty list —
  // a check that could never fail is worse than no check.
  const guardAt = stack.findIndex((l) => !l.route && l.regexp instanceof RegExp && /admin/.test(l.regexp.source));
  ok("the /admin guard is present in the stack", guardAt >= 0, `index ${guardAt}`);

  const collect = (from: number, to: number) => {
    const out: Array<{ method: string; path: string }> = [];
    for (const l of stack.slice(from, to)) {
      if (!l.route?.path?.startsWith("/admin")) continue;
      for (const [m, on] of Object.entries(l.route.methods)) if (on && m !== "_all") out.push({ method: m.toUpperCase(), path: l.route.path });
    }
    return out;
  };
  const beforeGuard = collect(0, guardAt);
  const routes = collect(guardAt, stack.length);

  console.log("\nRoutes registered BEFORE the guard are unauthenticated by construction\n");
  // The sign-in flow has to be reachable without a session. Nothing else does. Pinning the
  // exact set means a new admin route landing on the wrong side of the guard fails here
  // rather than shipping as a public endpoint.
  const EXPECTED_PUBLIC = new Set(["POST /admin/login", "GET /admin/session", "POST /admin/forgot", "POST /admin/elevate", "POST /admin/password"]);
  ok("the split is not vacuous — routes exist on both sides", beforeGuard.length > 0 && routes.length > 0,
    `${beforeGuard.length} before, ${routes.length} after`);
  const unexpectedPublic = beforeGuard.map((r) => `${r.method} ${r.path}`).filter((k) => !EXPECTED_PUBLIC.has(k));
  ok("only the sign-in flow sits before the guard", unexpectedPublic.length === 0,
    unexpectedPublic.length ? unexpectedPublic.join(", ") : beforeGuard.map((r) => `${r.method} ${r.path}`).join(", "));

  // Sitting before the guard is only safe if the handler authenticates itself. Probe the
  // ones that are not meant to be anonymous: a 401 without a token is the whole contract.
  // These calls move nothing — they are rejected before any handler logic runs.
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  const MUST_AUTH = ["POST /admin/password", "POST /admin/elevate"];
  for (const key of MUST_AUTH) {
    const [m, path] = key.split(" ");
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: m, headers: { "content-type": "application/json" }, body: "{}" });
    ok(`${key} refuses an anonymous caller`, r.status === 401, `HTTP ${r.status}`);
  }
  server.close();
  const byMethod = routes.reduce<Record<string, number>>((a, r) => { a[r.method] = (a[r.method] ?? 0) + 1; return a; }, {});
  console.log(`\n${routes.length} admin routes: ${Object.entries(byMethod).map(([m, n]) => `${n} ${m}`).join(", ")}\n`);
  ok("the router exposes admin routes to check", routes.length > 20, String(routes.length));
  // The gap the sampling test leaves: writes are most of what an operator does.
  ok("write routes are included in this check", (byMethod.POST ?? 0) + (byMethod.PUT ?? 0) + (byMethod.PATCH ?? 0) + (byMethod.DELETE ?? 0) > 10,
    `${(byMethod.POST ?? 0) + (byMethod.PUT ?? 0) + (byMethod.PATCH ?? 0) + (byMethod.DELETE ?? 0)} writes`);

  console.log("\nEvery route resolves to a section\n");
  const sub = (p: string) => p.replace(/^\/admin/, "") || "/";
  // /users and /apikeys are handled by explicit Super-Admin branches inside the guard that
  // return before the section lookup — mapped by a different mechanism, not unmapped.
  // Handled by explicit branches inside the guard that return before the section lookup:
  // /users and /apikeys are Super-Admin-only by name, and /password authenticates itself.
  const BRANCHED = /^\/(users|apikeys|password|login|session|forgot|elevate)(\/|$)/;
  const unmapped = routes.filter((r) => !BRANCHED.test(sub(r.path)) && sectionForPath(sub(r.path)) === null);
  ok("no admin route is unmapped — an unmapped route is 403 to everyone",
    unmapped.length === 0,
    unmapped.length ? unmapped.map((r) => `${r.method} ${r.path}`).join(", ") : "all mapped");

  console.log("\nEvery section a route maps to is reachable by some role\n");
  // A route mapped to a section no role can access is dark in a subtler way: mapped,
  // guarded, and permanently 403.
  const sections = [...new Set(routes.map((r) => sectionForPath(sub(r.path))).filter((s): s is NonNullable<typeof s> => !!s))];
  const orphan = sections.filter((s) => !ADMIN_ROLES.some((role) => canAccess(role, s)));
  ok("no section is unreachable by every role", orphan.length === 0, orphan.length ? orphan.join(", ") : `${sections.length} sections, all reachable`);

  console.log("\nEvery section an operator may access is reachable in the console\n");
  // A section can have routes, permissions and a working view and still be INVISIBLE,
  // because the console's nav keeps its own copy of the section list. Nothing reconciles
  // the two, so a section added to shared/roles.ts appears nowhere and no test notices —
  // the same duplicated-list drift that hid campay_holder from the identity chain and
  // CamPay from the partner registry.
  const { readFileSync } = await import("node:fs");
  const rolesSrc = readFileSync(new URL("../../shared/roles.ts", import.meta.url), "utf8");
  const consoleSrc = readFileSync(new URL("../../app/src/pages/admin/AdminConsole.tsx", import.meta.url), "utf8");
  const sectionBlock = /export type Section =([\s\S]*?);/.exec(rolesSrc)?.[1] ?? "";
  const declared = [...new Set([...sectionBlock.matchAll(/"([a-z]+)"/g)].map((m) => m[1]))];
  const navKeys = new Set([...consoleSrc.matchAll(/\[\s*"([a-z]+)"\s*,\s*"/g)].map((m) => m[1]));
  const viewBlock = /VIEWS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(consoleSrc)?.[1] ?? "";
  const viewKeys = new Set([...viewBlock.matchAll(/^\s*([a-z]+)\s*:/gm)].map((m) => m[1]));
  // The Capital module is deliberately outside the console: AdminConsole routes those
  // roles to their own pages (/capital-intelligence, /investors, /capital, /ai-copilot).
  const OUTSIDE_CONSOLE = new Set(["capital", "copilot", "intelligence", "investors", "portal"]);
  ok("the section list was parsed", declared.length > 15, `${declared.length} sections`);
  const noNav = declared.filter((s2) => !OUTSIDE_CONSOLE.has(s2) && !navKeys.has(s2));
  ok("every console section has a nav entry", noNav.length === 0, noNav.length ? noNav.join(", ") : "all present");
  const noView = declared.filter((s2) => !OUTSIDE_CONSOLE.has(s2) && !viewKeys.has(s2));
  ok("every console section has a view", noView.length === 0, noView.length ? noView.join(", ") : "all present");

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
