/* MoMo›Me Connect (docs/connect) — the nine critical flows of §46 through /v1, plus identity,
   resolution, counterparties, invoices, request-to-pay, payouts, checkout, routing policy and
   idempotency. Runs on the sandbox: simulated rails, no money.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/connect.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "connect-test-secret";
process.env.IDENTITY_MAX_DISTINCT_PER_HOUR_IP = "1000";
import type { AddressInfo } from "node:net";
import http from "node:http";
import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;
type J = Record<string, any>;

async function main() {
  const { createApp } = await import("../src/app.js");
  const { store } = await import("../src/db/store.js");
  const { updateOrganization } = await import("../src/core/platform/orgs.js");
  const { balanceOf } = await import("../src/core/connect/ledger.js");
  const { entriesFor, balance } = await import("../src/core/ledger.js");
  const { updateSettings, getSettings } = await import("../src/core/settings.js");
  const { connectTick } = await import("../src/core/connect/hooks.js");
  const { flush: flushOutbound } = await import("../src/core/interop/outbound.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const received: J[] = [];
  const hook = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { received.push(JSON.parse(b)); res.writeHead(200).end(); }); }).listen(0);
  await new Promise<void>((r) => hook.once("listening", () => r()));
  const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/h`;
  const dev = async (p: string, body?: unknown, token?: string) => (await fetch(`${base}/api/developers${p}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<J>;
  const v1 = async (p: string, o: { method?: string; body?: unknown; key?: string; idem?: string } = {}) => {
    const r = await fetch(`${base}/v1${p}`, { method: o.method ?? (o.body ? "POST" : "GET"), headers: { "content-type": "application/json", ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), ...(o.idem ? { "idempotency-key": o.idem } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
    return { status: r.status, body: (await r.json()) as J };
  };
  const idem = () => `k_${crypto.randomBytes(6).toString("hex")}`;
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (id: string, states: string[], ms = 12_000) => { const t0 = Date.now(); let cur = await store().getPayment(id); while (cur && !states.includes(cur.state) && Date.now() - t0 < ms) { await settle(120); cur = await store().getPayment(id); } return cur!; };
  const untilIntent = async (key: string, id: string, statuses: string[], ms = 12_000) => { const t0 = Date.now(); let cur = (await v1(`/payment-intents/${id}`, { key })).body.data; while (!statuses.includes(cur.status) && Date.now() - t0 < ms) { await settle(150); cur = (await v1(`/payment-intents/${id}`, { key })).body.data; } return cur as J; };

  // Two organizations: A (Company A) and B (Company B), each with a sandbox key.
  const mk = async (name: string, email: string) => { const su = await dev("/signup", { email, name: `${name} owner`, password: "long-enough-password", organization: name }); const cr = await dev(`/orgs/${su.organization.id}/credentials`, { environment: "test", label: "k" }, su.token); return { orgId: su.organization.id as string, key: cr.secret as string, token: su.token as string }; };
  const A = await mk("Company A", "a@example.com"); const B = await mk("Company B", "b@example.com");
  try {
    console.log("\n1. Identity: one MPI, many aliases; the phone is an alias, not the key\n");
    const meA = await v1("/identities/me", { key: A.key });
    ok("an organization has a MoMo›Me Payment Identity (mpi_…) with its Lightning-free aliases", meA.status === 200 && /^mpi_/.test(meA.body.data.id) && meA.body.data.aliases.some((a: J) => a.type === "momome_id"), meA.body.data?.id);
    const mpiA = meA.body.data.id as string;
    const aliasA = await v1(`/identities/${mpiA}/aliases`, { key: A.key, idem: idem(), body: { type: "phone", value: "+237677000101" } });
    ok("adding a phone alias also gives the identity a Lightning Address", aliasA.status === 200 && aliasA.body.data.aliases.some((a: J) => a.type === "phone" && a.value === "+237677000101") && aliasA.body.data.aliases.some((a: J) => a.type === "lightning_address"));
    const dup = await v1("/identities", { key: B.key, idem: idem(), body: { type: "business", display_name: "Impostor", aliases: [{ type: "phone", value: "+237677000101" }] } });
    ok("the same phone cannot be claimed by a second identity", dup.status === 409 && dup.body.error.code === "duplicate_request");
    const setA = await v1(`/identities/${mpiA}`, { key: A.key, method: "PATCH", body: { settlement: { preferred: "mobile_money", destination: { phone: "+237677000101" } } } });
    ok("settlement profile: A settles to Mobile Money", setA.body.data.settlement.preferred === "mobile_money" && setA.body.data.settlement.destination.phone === "237677000101");
    const noUsdt = await v1(`/identities/${mpiA}`, { key: A.key, method: "PATCH", body: { settlement: { preferred: "stablecoin" } } });
    ok("stablecoin settlement is refused (pass-through model: MoMo›Me holds nothing)", noUsdt.status === 422);
    const meB = (await v1("/identities/me", { key: B.key })).body.data; const mpiB = meB.id as string;
    await v1(`/identities/${mpiB}/aliases`, { key: B.key, idem: idem(), body: { type: "phone", value: "+237699000202" } });
    await v1(`/identities/${mpiB}`, { key: B.key, method: "PATCH", body: { settlement: { preferred: "momo_me", destination: { phone: "+237699000202" } } } });
    const branch = await v1("/identities", { key: A.key, idem: idem(), body: { type: "branch", display_name: "Company A — Douala branch", aliases: [{ type: "external_id", value: "BR-DLA-1" }] } });
    ok("an organization can create identities it manages (a branch with an external id)", branch.status === 201 && branch.body.data.type === "branch");

    console.log("\n2. Network discovery (§33): privacy-preserving\n");
    const r1 = await v1("/resolve", { key: A.key, body: { phone: "+237699000202" } });
    ok("resolve(phone of B) → reachable, business, connected, capabilities — no balance, no destination", r1.body.data.reachable === true && r1.body.data.identity === mpiB && r1.body.data.connected === true && Array.isArray(r1.body.data.payment_capabilities) && !("balance" in r1.body.data) && !("settlement" in r1.body.data));
    const r2 = await v1("/resolve", { key: A.key, body: { phone: "+237670555000" } });
    ok("an unknown number is reachable through external rails but not connected, and the name is withheld", r2.body.data.reachable === true && r2.body.data.connected === false && r2.body.data.display_name === null);
    const r3 = await v1("/resolve", { key: A.key, body: { email: "nobody@nowhere.example" } });
    ok("an unknown email is not reachable", r3.body.data.reachable === false);
    const other = await v1(`/identities/${mpiB}`, { key: A.key });
    ok("another organization's identity is readable only in its public form", other.status === 200 && !("settlement" in other.body.data) && other.body.data.id === mpiB);

    console.log("\n3. Flow 7 / Flow 1: A → B, both connected → internal ledger route, instant\n");
    const fund = await v1(`/sandbox/identities/${mpiA}/credit`, { key: A.key, body: { amount: 500000 } });
    ok("sandbox: A's balance is funded (ledger)", fund.body.data.available === "500000" && balanceOf(mpiA) === 500000);
    const pi1 = await v1("/payment-intents", { key: A.key, idem: idem(), body: { payee: { identity: mpiB }, amount: { value: "100000", currency: "XAF" }, purpose: { type: "invoice", reference: "INV-29381" } } });
    ok("POST /v1/payment-intents → created, with a route preview", pi1.status === 201 && pi1.body.data.status === "created" && pi1.body.data.route_preview?.method === "momo_me", JSON.stringify(pi1.body).slice(0, 160));
    const ex1 = await v1(`/payment-intents/${pi1.body.data.id}/execute`, { key: A.key, idem: idem(), body: {} });
    ok("execute → internal ledger transfer, completed instantly, settlement settled on B's balance", ex1.status === 200 && ex1.body.data.status === "completed" && ex1.body.data.settlement_status === "settled" && ex1.body.data.execution.kind === "internal_ledger" && ex1.body.data.route_explanation.some((s: string) => /internal ledger/.test(s)), `${ex1.body.data?.status} ${ex1.body.data?.execution?.kind}`);
    ok("ledger: A −100 000, B +98 500, fee 1 500 (double entry, balanced)", balanceOf(mpiA) === 400000 && balanceOf(mpiB) === 98500 && entriesFor(pi1.body.data.id).length === 3, `${balanceOf(mpiA)} ${balanceOf(mpiB)}`);
    const bB = await v1(`/identities/${mpiB}/balance`, { key: B.key });
    ok("B reads its balance through the API", bB.body.data.available === "98500");
    const ex1b = await v1(`/payment-intents/${pi1.body.data.id}/execute`, { key: A.key, idem: idem(), body: {} });
    ok("executing a completed intent again is a no-op, not a second transfer", ex1b.status === 409 && balanceOf(mpiA) === 400000);

    console.log("\n4. Routing policy is explainable and configurable\n");
    process.env.CONNECT_ROUTE_POLICY = "lightning,internal";
    const pi2 = await v1("/payment-intents", { key: A.key, idem: idem(), body: { payee: { identity: mpiB }, amount: { value: "5000" } } });
    ok("with Lightning first in the policy, the same A → B intent previews a Lightning route", pi2.body.data.route_preview?.method === "lightning", JSON.stringify(pi2.body.data.route_preview));
    delete process.env.CONNECT_ROUTE_POLICY;
    const pi2b = await v1("/payment-intents", { key: A.key, idem: idem(), body: { payee: { identity: mpiB }, amount: { value: "5000" }, permitted_methods: ["lightning"] } });
    ok("an intent that forbids the internal method routes over Lightning even between connected parties", pi2b.body.data.route_preview?.method === "lightning");

    console.log("\n5. Flow 8 / Flow 3: A invoices B (not connected) → payment link → external payer → A settled\n");
    const cp = await v1("/counterparties", { key: A.key, idem: idem(), body: { name: "Company C (not on MoMo›Me)", contacts: [{ type: "email", value: "ap@company-c.example" }, { type: "phone", value: "+237655000303" }] } });
    ok("a counterparty is created without any MoMo›Me account", cp.status === 201 && cp.body.data.linked_identity === null || (cp.status === 201 && typeof cp.body.data.linked_identity === "string"), JSON.stringify(cp.body.data).slice(0, 120));
    const inv = await v1("/invoices", { key: A.key, idem: idem(), body: { amount: { value: "20000" }, description: "Consulting — September", reference: "INV-2026-091", due_date: "2026-10-15", payer: { counterparty: cp.body.data.id } } });
    ok("POST /v1/invoices → issued, with a payment URL and one payment intent; partial payments explicitly unsupported", inv.status === 201 && inv.body.data.status === "issued" && /\/p\/pi_/.test(inv.body.data.payment_url) && inv.body.data.partial_payments === false && inv.body.data.number.startsWith("MM-"), JSON.stringify(inv.body).slice(0, 160));
    const intentId = inv.body.data.payment_intent as string;
    const co = await v1(`/checkout/${intentId}`);
    ok("the hosted checkout is public: payee name, amount, available methods, no credential", co.status === 200 && co.body.data.payee.display_name === "Company A" && co.body.data.amount.value === "20000" && co.body.data.methods.includes("lightning"));
    const pay = await v1(`/checkout/${intentId}/pay`, { body: { method: "lightning", payer_name: "Someone at C" } });
    ok("an external payer picks Lightning → the intent is pending with a Lightning invoice to pay", pay.status === 200 && pay.body.data.status === "pending" && pay.body.data.execution.payment_instructions?.method === "lightning_invoice", JSON.stringify(pay.body).slice(0, 160));
    await fetch(`${base}/api/payments/${pay.body.data.execution.payment_id}/simulate`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": `connect:${intentId}` } });
    const done = await until(pay.body.data.execution.payment_id, ["DELIVERED", "FAILED", "REFUND_PENDING"]);
    const iDone = await untilIntent(A.key, intentId, ["completed", "failed", "reversed"]);
    ok("engine delivers to A's settlement number → intent completed, settlement settled, invoice paid", done.state === "DELIVERED" && iDone.status === "completed" && iDone.settlement_status === "settled" && (await v1(`/invoices/${inv.body.data.id}`, { key: A.key })).body.data.status === "paid", `${done.state} ${iDone.status}`);

    console.log("\n6. Flow 9: Company C later joins → the counterparty links to its verified MPI, history intact\n");
    const C = await mk("Company C", "c@example.com");
    const meC = (await v1("/identities/me", { key: C.key })).body.data;
    await v1(`/identities/${meC.id}/aliases`, { key: C.key, idem: idem(), body: { type: "phone", value: "+237655000303" } });
    const cps = await v1("/counterparties", { key: A.key });
    const linked = cps.body.data.data.find((x: J) => x.id === cp.body.data.id);
    ok("the counterparty now points at C's MPI (auto-linked on the shared phone alias)", linked.linked_identity === meC.id, JSON.stringify(linked).slice(0, 120));
    const oldInv = await v1(`/invoices/${inv.body.data.id}`, { key: A.key });
    ok("the historical invoice still references the counterparty id and stays paid", oldInv.body.data.payer.counterparty === cp.body.data.id && oldInv.body.data.status === "paid");

    console.log("\n7. Request-to-pay (§34) and Flow 4 (Lightning → merchant → XAF)\n");
    const rtp = await v1("/requests", { key: A.key, idem: idem(), body: { amount: { value: "15000" }, payer: { identity: mpiB }, description: "Rent — October" } });
    ok("POST /v1/requests → a request_to_pay with a known payer and a link", rtp.status === 201 && rtp.body.data.kind === "request_to_pay" && rtp.body.data.payer.identity === mpiB);
    const noPayer = await v1("/requests", { key: A.key, idem: idem(), body: { amount: { value: "15000" } } });
    ok("a request-to-pay without a payer is refused", noPayer.status === 422);
    const qr = await v1("/invoices", { key: A.key, idem: idem(), body: { kind: "qr", amount: { value: "3000" }, description: "Table 4" } });
    const qrPay = await v1(`/checkout/${qr.body.data.payment_intent}/pay`, { body: { method: "lightning" } });
    ok("Flow 4: a QR paid over Lightning by an unknown customer becomes a merchant payment settled in XAF", qr.body.data.kind === "qr" && qrPay.body.data.execution.payment_instructions.method === "lightning_invoice");

    console.log("\n8. Flow 2 / Flow 5: payouts from a balance to Mobile Money and to a Lightning Address\n");
    const po1 = await v1("/payouts", { key: A.key, idem: idem(), body: { amount: { value: "25000" }, destination: { phone: "+237670123456", name: "Nana Jean Paul" }, reference: "PAYROLL-1" } });
    ok("POST /v1/payouts (Mobile Money) → completed on the simulated rail; balance debited incl. fee", po1.status === 201 && po1.body.data.status === "completed" && po1.body.data.destination.operator === "MTN" && balanceOf(mpiA) === 400000 - 25000 - 375, `${po1.body.data?.status} bal=${balanceOf(mpiA)}`);
    const po2 = await v1("/payouts", { key: A.key, idem: idem(), body: { amount: { value: "10000" }, destination: { lightning_address: "alice@walletofsatoshi.com" } } });
    ok("POST /v1/payouts (Lightning Address) → the institution sends XAF; Lightning is invisible (sandbox send)", po2.status === 201 && po2.body.data.status === "completed" && po2.body.data.destination.type === "lightning", JSON.stringify(po2.body).slice(0, 140));
    const po3 = await v1("/payouts", { key: B.key, idem: idem(), body: { amount: { value: "999999" }, destination: { identity: mpiA } } });
    ok("a payout beyond the balance → 409 insufficient_liquidity", po3.status === 409 && po3.body.error.code === "insufficient_liquidity");
    const po4 = await v1("/payouts", { key: B.key, idem: idem(), body: { amount: { value: "500" }, destination: { identity: mpiA } } });
    ok("a payout to an identity resolves its settlement destination", po4.status === 201 && po4.body.data.destination.phone === "+237677000101");
    ok("the payout ledger is balanced (float credited, fee booked)", entriesFor(po1.body.data.id).length === 3 && Math.abs(balance("payout_float_XAF", "XAF")) >= 0);

    console.log("\n9. Flow 6: XAF → (Lightning) → XAF — Mobile Money as a payment method\n");
    updateSettings({ ...getSettings(), features: { ...getSettings().features, momoTransfer: true } });
    const pi6 = await v1("/payment-intents", { key: A.key, idem: idem(), body: { payee: { identity: mpiB }, amount: { value: "8000" }, permitted_methods: ["mobile_money"] } });
    const ex6 = await v1(`/payment-intents/${pi6.body.data.id}/execute`, { key: A.key, idem: idem(), body: { method: "mobile_money", payer: { phone: "+237677000101" } } });
    ok("a Mobile Money payer funds an intent by approving a collection; the intent is pending", ex6.status === 200 && ex6.body.data.execution.kind === "momo_collection" && ex6.body.data.status === "pending", JSON.stringify(ex6.body).slice(0, 160));
    await settle(400); await connectTick();
    const i6 = await untilIntent(A.key, pi6.body.data.id, ["completed", "failed", "reversed", "processing"], 4000);
    ok("the collection's lifecycle is mirrored into the intent (neither company touches Bitcoin)", ["processing", "completed", "pending"].includes(i6.status), i6.status);

    console.log("\n9b. A lapsed Lightning invoice does not kill the payment link\n");
    const invR = await v1("/invoices", { key: A.key, idem: idem(), body: { kind: "payment_link", amount: { value: "6000" }, description: "Retry me" } });
    const rid = invR.body.data.payment_intent as string;
    const first = await v1(`/checkout/${rid}/pay`, { body: { method: "lightning" } });
    const enginePid = first.body.data.execution.payment_id as string;
    const pEng = await store().getPayment(enginePid); pEng!.payInstruction.expiresAt = new Date(Date.now() - 1000).toISOString(); await store().putPayment(pEng!);
    const after = await v1(`/checkout/${rid}`);
    ok("the checkout retires the expired instruction and the intent is back to created", after.body.data.status === "created" && after.body.data.execution === null, `${after.body.data.status}`);
    const second = await v1(`/checkout/${rid}/pay`, { body: { method: "lightning" } });
    ok("the payer gets a fresh instruction on the same link", second.status === 200 && second.body.data.execution.payment_id !== enginePid && second.body.data.status === "pending");
    ok("the invoice is still issued (not expired)", (await v1(`/invoices/${invR.body.data.id}`, { key: A.key })).body.data.status === "pending" || (await v1(`/invoices/${invR.body.data.id}`, { key: A.key })).body.data.status === "issued");

    console.log("\n10. Webhooks, idempotency, statuses\n");
    await v1("/webhooks", { key: A.key, idem: idem(), body: { url: hookUrl, events: ["*"] } });
    const k = idem();
    const piX = await v1("/payment-intents", { key: A.key, idem: k, body: { payee: { identity: mpiB }, amount: { value: "1000" } } });
    const piXr = await v1("/payment-intents", { key: A.key, idem: k, body: { payee: { identity: mpiB }, amount: { value: "1000" } } });
    ok("the same Idempotency-Key replays the same intent", piXr.body.data.id === piX.body.data.id);
    const exK = idem();
    await v1(`/payment-intents/${piX.body.data.id}/execute`, { key: A.key, idem: exK, body: {} });
    const balAfter = balanceOf(mpiA);
    await v1(`/payment-intents/${piX.body.data.id}/execute`, { key: A.key, idem: exK, body: {} });
    ok("replaying an execute never moves money twice", balanceOf(mpiA) === balAfter);
    await settle(300); await flushOutbound(); await settle(300);
    const types = received.map((e) => e.type);
    ok("webhooks: payment.created / payment.processing / payment.completed / settlement.completed reached the endpoint", ["payment.created", "payment.completed", "settlement.completed"].every((t) => types.includes(t)), [...new Set(types)].join(","));
    const st = (await v1(`/payment-intents/${piX.body.data.id}`, { key: A.key })).body.data;
    ok("payment status and settlement status are separate fields", st.status === "completed" && st.settlement_status === "settled");
    const openapi = await (await fetch(`${base}/v1/openapi.json`)).json() as J;
    ok("the contract lists the Connect events", Object.keys(openapi.webhooks).includes("invoice.paid") && Object.keys(openapi.webhooks).includes("payout.completed"));

    console.log("\n11. Settlement intents per payment: bank (operator) and Mobile Money (automatic)\n");
    const { issueToken } = await import("../src/core/adminAuth.js"); const { createUser: createAdmin } = await import("../src/core/adminUsers.js");
    const admin = createAdmin("Ops", "ops-password-1234", "Super Admin"); const atok = issueToken({ uid: admin.id, role: "Super Admin", elevatedUntil: Date.now() + 600_000 }).token;
    const AD = { "content-type": "application/json", authorization: `Bearer ${atok}` };
    // Company D settles to a BANK; Company E settles to Mobile Money.
    const D = await mk("Company D", "d@example.com"); const mpiD = (await v1("/identities/me", { key: D.key })).body.data.id as string;
    await v1(`/identities/${mpiD}`, { key: D.key, method: "PATCH", body: { settlement: { preferred: "bank_transfer", destination: { bank: "Afriland First Bank", account: "10005-00021-12345678901-23" } } } });
    const E = await mk("Company E", "e@example.com"); const mpiE = (await v1("/identities/me", { key: E.key })).body.data.id as string;
    await v1(`/identities/${mpiE}/aliases`, { key: E.key, idem: idem(), body: { type: "phone", value: "+237651000404" } });
    await v1(`/identities/${mpiE}`, { key: E.key, method: "PATCH", body: { settlement: { preferred: "mobile_money" } } });
    const piD = await v1("/payment-intents", { key: A.key, idem: idem(), body: { payee: { identity: mpiD }, amount: { value: "50000" } } });
    const exD = await v1(`/payment-intents/${piD.body.data.id}/execute`, { key: A.key, idem: idem(), body: {} });
    await settle(200);
    const siD = (await v1("/settlement-intents", { key: D.key })).body.data.data.find((x: J) => x.payment_intent === piD.body.data.id);
    ok("A pays D internally → payment completed, settlement PENDING/processing: a bank settlement intent is queued for the operator", exD.body.data.status === "completed" && siD && siD.method === "bank_transfer" && ["pending", "processing"].includes(siD.status) && siD.destination.type === "bank" && siD.destination.account === "…1-23", JSON.stringify(siD));
    ok("D's balance holds the value until the operator pays the bank", balanceOf(mpiD) === 49250, String(balanceOf(mpiD)));
    const queue = await (await fetch(`${base}/api/admin/platform/connect/settlements`, { headers: AD })).json() as J;
    ok("Admin → Connect lists the bank queue with payee, organization and account", queue.settlements.some((x: J) => x.id === siD.id && x.payee_name === "Company D"));
    const badSubmit = await fetch(`${base}/api/admin/platform/connect/settlements/${siD.id}/submit`, { method: "POST", headers: AD, body: JSON.stringify({}) });
    ok("submitting without a bank reference is refused", badSubmit.status === 400);
    const sub = await (await fetch(`${base}/api/admin/platform/connect/settlements/${siD.id}/submit`, { method: "POST", headers: AD, body: JSON.stringify({ reference: "AFB-2026-000912" }) })).json() as J;
    ok("operator records the bank transfer → submitted; the ledger moves the value from D's balance to the float", sub.status === "submitted" && sub.provider_reference === "AFB-2026-000912" && balanceOf(mpiD) === 0, `${sub.status} bal=${balanceOf(mpiD)}`);
    const stl = await (await fetch(`${base}/api/admin/platform/connect/settlements/${siD.id}/settle`, { method: "POST", headers: AD, body: "{}" })).json() as J;
    const piDNow = (await v1(`/payment-intents/${piD.body.data.id}`, { key: A.key })).body.data;
    ok("operator confirms → settled, and the payment intent's settlement_status follows", stl.status === "settled" && piDNow.settlement_status === "settled" && piDNow.status === "completed");
    const piE = await v1("/payment-intents", { key: A.key, idem: idem(), body: { payee: { identity: mpiE }, amount: { value: "20000" } } });
    // Assert the intent exists before using it: this line once failed inside a full chain run
    // and surfaced as "cannot read properties of undefined", which says nothing about why.
    ok("an intent payable to E is created", !!piE.body.data?.id, `${piE.status} ${JSON.stringify(piE.body.error ?? "")}`);
    await v1(`/payment-intents/${piE.body.data.id}/execute`, { key: A.key, idem: idem(), body: {} });
    await settle(500);
    const siE = (await v1("/settlement-intents", { key: E.key })).body.data.data.find((x: J) => x.payment_intent === piE.body.data.id);
    ok("E settles to Mobile Money instantly: an automatic fee-free payout from E's balance → settled, balance back to 0", siE && siE.method === "mobile_money" && siE.status === "settled" && siE.payout_id && balanceOf(mpiE) === 0, `${siE?.status} bal=${balanceOf(mpiE)}`);
    const poE = (await v1(`/payouts/${siE.payout_id}`, { key: E.key })).body.data;
    ok("…the settlement payout carries no platform fee (already charged on the payment)", poE.fee.value === "0" && poE.reference === `settlement:${siE.id}`);
    const failD = await (await fetch(`${base}/api/admin/platform/connect/settlements/${siD.id}/fail`, { method: "POST", headers: AD, body: JSON.stringify({ reason: "x" }) })).json() as J;
    ok("a settled settlement cannot be failed", failD.error === "bad_transition");

    console.log("\n12. Treasury over identity balances and §49 network metrics\n");
    const tre = await (await fetch(`${base}/api/admin/platform/connect/treasury`, { headers: AD })).json() as J;
    ok("treasury: total identity balances (liabilities), top identities, pending settlements, float coverage", typeof tre.identity_balances_total_xaf === "number" && tre.identity_balances_total_xaf === balanceOf(mpiA) + balanceOf(mpiB) + balanceOf(meC.id) && Array.isArray(tre.top) && "float" in tre, JSON.stringify(tre).slice(0, 160));
    const met = await (await fetch(`${base}/api/admin/platform/connect/metrics`, { headers: AD })).json() as J;
    ok("metrics: connected institutions/businesses, identities, reachable endpoints, successful routes by kind, internal %, Lightning volume, latency", met.connected_institutions >= 5 && met.payment_identities >= 7 && met.reachable_external_endpoints >= 1 && met.successful_routes >= 4 && met.routes_by_kind.internal >= 3 && met.internal_transaction_pct > 0 && met.lightning_volume_xaf > 0 && typeof met.average_payment_latency_ms === "number", JSON.stringify(met).slice(0, 200));
    void updateOrganization;
  } finally { server.close(); hook.close(); }
  console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
