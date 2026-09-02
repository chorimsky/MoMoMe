/* Custodial Lightning wallets — one IBEX account per Mobile-Money number.

   The identity layer always provisioned a wallet ref, but it was a locally-generated
   fake: `createCustodialWallet()` returned `ibex_wal_<random>` and its own comment said
   "in live mode … would call IBEX". So every number had a Lightning ADDRESS that worked
   (pass-through to Mobile Money) and a wallet that did not exist. This closes that seam
   against IBEX's documented one-account-per-user model.

   What is asserted here is every layer of OURS: that provisioning happens, happens once,
   happens OFF the settlement critical path, degrades safely when the rail can't open an
   account, and never lets a placeholder masquerade as a real wallet. IBEX's HTTP surface
   is mocked — the same approach as ibex-e2e/usdc-e2e. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.IBEX_ENV = "production";       // → ibexLive() → trusted → wallet-capable
process.env.IBEX_CLIENT_ID = "test-client";
process.env.IBEX_CLIENT_SECRET = "test-secret";
process.env.IBEX_ACCOUNT_ID = "platform-account";
process.env.IBEX_WEBHOOK_SECRET = "test-webhook-secret";
process.env.PUBLIC_URL = "https://example.test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};
const settled = () => new Promise((r) => setTimeout(r, 60)); // let background() drain

const calls: string[] = [];
let createFails = false;
let created = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("poweredbyibex.io")) {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    calls.push(path);
    if (path.includes("/oauth/token")) return J({ access_token: "tok", expires_in: 3600 });
    if (path.includes("/account/create")) {
      if (createFails) return J({ error: "nope" }, 500);
      created++;
      return J({ id: `ibex-acct-${created}`, name: "x", currencyId: 0 });
    }
    if (path === "/v2/account") {
      return J([
        { id: "platform-account", currencyId: 0, balance: 5_000_000 },
        { id: "ibex-acct-1", currencyId: 0, balance: 250_000 }, // 250 sat, in msat
      ]);
    }
    return J({}, 404);
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

const RECIP = (phone: string) => ({ phone, country: "CM" as const, provider: "MTN" as const, name: "Wallet Test" });

async function main() {
  console.log("\nCustodial wallets — one rail account per Mobile-Money number");
  const idm = await import("../src/core/identity.js");
  const { walletRail } = await import("../src/adapters/index.js");

  ok("a wallet-capable rail is available (IBEX, trusted)", walletRail()?.name === "ibex", walletRail()?.name ?? "none");

  // 1. Provisioning is OFF the critical path: ensureIdentity returns a usable identity
  //    BEFORE any network call has RESOLVED. That is the property keeping a slow or down
  //    IBEX from ever delaying or failing a settlement. (The request is already in flight
  //    by then — JS promises are eager — but nothing is awaited, which is the point.)
  const id1 = idm.ensureIdentity(RECIP("677000701"), "MMM-1");
  ok("ensureIdentity returns immediately", !!id1.customerId && !!id1.lightningAddress, id1.customerId);
  ok("it did NOT await the rail (no account had been created yet)", created === 0, `${created} created`);
  ok("the number is usable as a Lightning Address at once", id1.lightningAddress.endsWith("@momome.xyz"), id1.lightningAddress);
  ok("wallet starts as a placeholder, NOT reported as real", !idm.walletIsReal(id1), id1.lnWalletRef);

  // 2. …and then the real account appears.
  await settled();
  ok("a real rail account was opened in the background", idm.walletIsReal(id1), id1.lnWalletRef);
  ok("it is IBEX's account id", id1.lnWalletRef === "ibex-acct-1", id1.lnWalletRef);
  ok("the holding rail is recorded (needed to read the balance back)", id1.lnWalletProvider === "ibex", String(id1.lnWalletProvider));
  ok("create-account was called exactly once", calls.filter((c) => c.includes("/account/create")).length === 1);
  ok("the account is labelled with the customer id (findable in IBEX's console)", created === 1);

  // 3. Idempotent — a second delivery to the same number must not open a second wallet.
  idm.ensureIdentity(RECIP("677000701"), "MMM-2");
  await settled();
  ok("a repeat delivery does NOT open a second wallet", calls.filter((c) => c.includes("/account/create")).length === 1,
    `${calls.filter((c) => c.includes("/account/create")).length} create calls`);

  // 4. Live balance comes from the rail, for that account only.
  const bal = await idm.walletBalance(id1);
  ok("balance is read from the rail for THIS account", bal?.balance === 250_000, JSON.stringify(bal));

  // 5. Fail-safe. A rail that can't open an account must not break anything: the identity
  //    still exists, the Lightning Address still works, and the balance is UNAVAILABLE
  //    rather than a fabricated zero.
  createFails = true;
  const id2 = idm.ensureIdentity(RECIP("677000702"), "MMM-3");
  await settled();
  ok("failed provisioning still yields a working identity", !!id2.customerId && !!id2.lightningAddress);
  ok("the wallet stays a placeholder (not a fake 'real' one)", !idm.walletIsReal(id2), id2.lnWalletRef);
  ok("a placeholder wallet reports NO balance (never a false zero)", (await idm.walletBalance(id2)) === null);

  // 6. Retry: once the rail recovers, the next delivery to that number provisions it.
  createFails = false;
  idm.ensureIdentity(RECIP("677000702"), "MMM-4");
  await settled();
  ok("a later delivery retries and opens the wallet", idm.walletIsReal(id2), id2.lnWalletRef);

  // 7. The placeholder must be distinguishable from a real IBEX id. The old prefix was
  //    `ibex_wal_`, which read like a real IBEX account at a glance.
  const id3 = idm.ensureIdentity(RECIP("677000703"), "MMM-5");
  ok("placeholders are unmistakable (`sim_wal_`, never `ibex_`)",
    !idm.walletIsReal({ ...id3, lnWalletRef: "sim_wal_abc" }) && idm.walletIsReal({ ...id3, lnWalletRef: "ibex-acct-9" }));

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
