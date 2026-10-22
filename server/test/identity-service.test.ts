/* POST /v1/recipients/validate — the endpoint a partner would buy "who owns this number"
   through, so what it claims has to be exactly what a provider said.

   It used to report `active: name ? true : null`. That is an INFERENCE, and a wrong one:
   a name coming back does not mean anybody checked whether the wallet is open. CamPay's
   holder_info returns a name and no status at all; MTN's own API checks /active
   explicitly; Wallet2Cash returns isActive alongside the name. So for two of the three the
   endpoint was answering "active: true" on the strength of having a name, and a caller
   deciding whether to pay reads that as a fact we established. The resolver already knew
   the difference — ACTIVE, INACTIVE, UNKNOWN — and it was thrown away on the way out.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/identity-service.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";

import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  type Body = { valid?: boolean; name?: string | null; active?: boolean | null; account_status?: string;
    name_status?: string; operator?: string | null; source?: { provider: string | null; freshness: string; checked_at: string | null };
    request_id?: string | null; error?: { code?: string } };

  // A credential the way a partner actually gets one: sign up, then mint a test key.
  const dev = async (path: string, body?: unknown, token?: string) => {
    const r = await fetch(`${base}/api/developers${path}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: (await r.json()) as Record<string, never> };
  };
  const su = await dev("/signup", { email: "identity@buyer.example", name: "Buyer", password: "correct-horse-battery", organization: "Buyer Ltd" });
  const tok = su.body.token as unknown as string;
  const orgId = (su.body.organization as unknown as { id: string }).id;
  const cr = await dev(`/orgs/${orgId}/credentials`, { environment: "test", label: "identity" }, tok);
  const key = cr.body.secret as unknown as string;
  ok("a partner can mint a key and call this endpoint", typeof key === "string" && key.startsWith("mm_test_"), String(key).slice(0, 12));

  const validate = async (body: unknown): Promise<{ status: number; body: Body }> => {
    const r = await fetch(`${base}/v1/recipients/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    // /v1 wraps every success in { data: … } — read through the envelope, not past it.
    const j = (await r.json()) as { data?: Body } & Body;
    return { status: r.status, body: (j.data ?? j) as Body };
  };

  try {
    console.log("\nThe endpoint answers at all\n");
    const a = await validate({ phone: "+237670000001", country: "CM" });
    ok("a well-formed number is accepted", a.status === 200, `${a.status} ${JSON.stringify(a.body).slice(0, 90)}`);
    if (a.status !== 200) { console.log("    (credential issue — the assertions below need an authenticated call)"); }

    console.log("\n`active` is a statement a provider made, or nothing at all\n");
    const d = (a.body.valid ? a.body : (await validate({ phone: "+237670000001", country: "CM" })).body);
    ok("account_status is always present", typeof d.account_status === "string", d.account_status);
    ok("active is true/false ONLY when the status says so, else null",
      (d.account_status === "ACTIVE" && d.active === true)
      || (d.account_status === "INACTIVE" && d.active === false)
      || (!["ACTIVE", "INACTIVE"].includes(d.account_status ?? "") && d.active === null),
      `${d.account_status} → ${String(d.active)}`);
    ok("a name alone never implies active — the old inference is gone",
      !(d.name && d.active === true && !["ACTIVE"].includes(d.account_status ?? "")),
      `name=${d.name ?? "null"} active=${String(d.active)} status=${d.account_status}`);

    console.log("\nEvery answer carries where it came from\n");
    ok("the source block is present", typeof d.source === "object" && d.source !== null);
    ok("…naming the freshness", ["live", "cache", "sandbox", "none", "not_checked"].includes(d.source?.freshness ?? ""), d.source?.freshness);
    ok("…and the provider, or null where nothing answered", d.source !== undefined && "provider" in d.source);
    ok("a request id is returned for support correlation", "request_id" in d);

    console.log("\nA bad number is refused before any provider is called\n");
    const bad = await validate({ phone: "+237000000000", country: "CM" });
    ok("an unknown-operator prefix is invalid", bad.body.valid === false, JSON.stringify(bad.body).slice(0, 80));
    ok("…with name_status not_checked, not 'unknown'", bad.body.name_status === "not_checked", bad.body.name_status);
    ok("…and never an active claim", bad.body.active === undefined || bad.body.active === null, String(bad.body.active));
    const empty = await validate({ country: "CM" });
    ok("a missing phone is a validation error", empty.status === 422, String(empty.status));

    console.log("\nIt cannot be used to enumerate the subscriber base\n");
      const noAuth = await fetch(`${base}/v1/recipients/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "+237670000001" }) });
    ok("…and refuses an unauthenticated caller outright", noAuth.status === 401, String(noAuth.status));
  } finally { server.close(); }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
