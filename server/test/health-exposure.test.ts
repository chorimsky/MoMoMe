/* /health/deep is public. The verdict may be; the money may not.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/health-exposure.test.ts

   It was returning every rail's treasury balance, the live alert keys and the deployed
   commit to anyone who asked — so a stranger could poll it to learn how much float we hold
   and the exact moments we cannot pay out. It has to stay reachable: the deploy gate and
   any uptime monitor read it and neither carries a credential. The gate only ever reads
   `problems` and `version`, so the figures can go without breaking anything. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "health-exposure-test";
process.env.HEALTH_DETAIL_TOKEN = "test-health-detail-token";
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-real-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key";
process.env.CAMPAY_ENV = "production";
process.env.CAMPAY_API_URL = "https://campay.exposure.invalid/api";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("campay.exposure.invalid")) {
    if (url.includes("/balance/")) return J({ total_balance: 4900, mtn_balance: 0, orange_balance: 0 });
    return J({});
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (h: Record<string, string> = {}) => {
    const r = await fetch(`${base}/health/deep`, { headers: h });
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };

  try {
    console.log("\nAnonymous: the verdict, without the money\n");
    const anon = await get();
    const text = JSON.stringify(anon.body);
    ok("the probe still answers", anon.status === 200 || anon.status === 503, String(anon.status));
    ok("`problems` is still reported — the gate depends on it", Array.isArray(anon.body.problems));
    const authForVersion = await get({ "x-health-token": "test-health-detail-token" });
    ok("`version` is unaffected by redaction — the gate depends on it",
      JSON.stringify(anon.body.version ?? null) === JSON.stringify(authForVersion.body.version ?? null),
      `anon=${anon.body.version ?? "(unset in tests)"} auth=${authForVersion.body.version ?? "(unset in tests)"}`);
    // The actual exposure.
    ok("no rail balance is returned", (anon.body.rails ?? []).every((r: Record<string, unknown>) => !("balanceXaf" in r) && !("spendableXaf" in r) && !("byProvider" in r)),
      JSON.stringify((anon.body.rails ?? [])[0] ?? {}));
    ok("the 4 900 figure appears nowhere in the response", !/4900|4 900/.test(text));
    // Whether a rail can pay is operationally useful and reveals no amount.
    ok("…but whether a rail is funded is still said", (anon.body.rails ?? []).every((r: Record<string, unknown>) => "funded" in r),
      JSON.stringify((anon.body.rails ?? []).map((r: Record<string, unknown>) => [r.name, r.funded])));
    // Alert keys stay listed for everyone: they name a condition, never an amount, and a
    // monitor needs them (ops-readiness.test.ts asserts the probe lists them by key).
    ok("alert keys remain listed — they carry no amount", Array.isArray(anon.body.alerts), JSON.stringify(anon.body.alerts));

    console.log("\nA problem string must not leak the figure either\n");
    const stranded = (anon.body.problems ?? []).find((p: string) => /carrier float/.test(p));
    ok("the stranded-float problem is still raised", !!stranded, String(stranded));
    ok("…with the amount redacted", !!stranded && !/\d/.test(stranded), String(stranded));

    console.log("\nWith the token: the full picture\n");
    const auth = await get({ "x-health-token": "test-health-detail-token" });
    ok("balances are returned", (auth.body.rails ?? []).some((r: Record<string, unknown>) => "balanceXaf" in r));
    ok("per-carrier floats are returned", (auth.body.rails ?? []).some((r: Record<string, unknown>) => r.byProvider));
    ok("alert keys are returned with the token too", Array.isArray(auth.body.alerts));

    console.log("\nThe egress address: the one fact that fixes an allowlist outage\n");
    // It lived only behind an admin login, so during Peexit's four-day 403 the number
    // needed to fix it required somebody to open the console. It is our outbound address,
    // so it is token-gated like the money — never public.
    ok("no egress block for an anonymous caller", !("egress" in anon.body), JSON.stringify(anon.body.egress ?? null));
    ok("the whole response mentions no IP address", !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(text), text.slice(0, 160));
    ok("with the token it is present", !!auth.body.egress, JSON.stringify(auth.body.egress ?? null));
    ok("…and says whether it matches what the rail expects", auth.body.egress && "matches" in auth.body.egress && "expected" in auth.body.egress,
      JSON.stringify(auth.body.egress ?? null));

    console.log("\nA wrong token is not a token\n");
    const bad = await get({ "x-health-token": "wrong-token-of-same-len--" });
    ok("balances stay hidden", (bad.body.rails ?? []).every((r: Record<string, unknown>) => !("balanceXaf" in r)));
    ok("…and so does the egress address", !("egress" in bad.body), JSON.stringify(bad.body.egress ?? null));

    console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  } finally { server.close(); }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
