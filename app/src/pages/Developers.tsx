/* ============================================================
   MoMo›Me Developers (/developers) — the API v1 documentation landing (docs/api-v1 §53).
   The reference section is generated from the live OpenAPI document (GET /v1/openapi.json)
   so it can never drift from the server; the guides are written by hand.
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { V1_BASE } from "../api/developers.js";
import "./Developers.css";

type Lang = "curl" | "js" | "python" | "php" | "laravel";
const LANGS: Array<[Lang, string]> = [["curl", "cURL"], ["js", "JavaScript"], ["python", "Python"], ["php", "PHP"], ["laravel", "Laravel"]];

function Code({ label, children }: { label: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return <div className="code"><div className="bar"><span className="lbl">{label}</span><button type="button" className="copy" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button></div><pre><code>{children}</code></pre></div>;
}
function Tabs({ samples, label }: { samples: Record<Lang, string>; label: string }) {
  const [lang, setLang] = useState<Lang>(() => { try { return (localStorage.getItem("mm:dev:lang") as Lang) || "curl"; } catch { return "curl"; } });
  const pick = (l: Lang) => { setLang(l); try { localStorage.setItem("mm:dev:lang", l); } catch { /* */ } };
  return <div><div className="lang-tabs">{LANGS.map(([k, n]) => <button key={k} type="button" className={lang === k ? "on" : ""} onClick={() => pick(k)}>{n}</button>)}</div><Code label={`${label} · ${LANGS.find(([k]) => k === lang)![1]}`}>{samples[lang]}</Code></div>;
}
function Params({ rows }: { rows: Array<[string, string, string]> }) {
  return <div className="tbl"><div className="r h"><span>Field</span><span>Type</span><span>Description</span></div>{rows.map(([nm, ty, ds], i) => <div className="r" key={`${nm}-${i}`}><span className="nm">{nm}</span><span className="ty">{ty}</span><span className="ds">{ds}</span></div>)}</div>;
}

/* ---------- samples in five languages, from one template ---------- */
function samples(base: string, method: "GET" | "POST", path: string, body: unknown | null, idem?: string): Record<Lang, string> {
  const json = body ? JSON.stringify(body, null, 2) : "";
  const hdrIdem = idem ? `\n  -H "Idempotency-Key: ${idem}" \\` : "";
  return {
    curl: `curl -X ${method} ${base}${path} \\\n  -H "Authorization: Bearer mm_test_…" \\${hdrIdem}${body ? `\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'` : ""}`,
    js: `import { MoMoMe } from "@momome/sdk";\nconst momome = new MoMoMe(process.env.MOMOME_KEY); // mm_test_… or mm_live_…\n\n${jsCall(method, path, body, idem)}`,
    python: `from momome import MoMoMe\nmomome = MoMoMe(os.environ["MOMOME_KEY"])\n\n${pyCall(method, path, body, idem)}`,
    php: `<?php\nrequire 'vendor/autoload.php';\n$momome = new MoMoMe\\Client(getenv('MOMOME_KEY'));\n\n${phpCall(method, path, body, idem)}`,
    laravel: `// config/services.php → 'momome' => ['key' => env('MOMOME_KEY')]\nuse MoMoMe\\Laravel\\Facades\\MoMoMe;\n\n${phpCall(method, path, body, idem, true)}`,
  }; function jsCall(m: string, p: string, b: unknown, i?: string) { const [res, fn, arg] = sdkCall(p, m); return `const ${res} = await momome.${fn}(${arg ? `"${arg}"` : ""}${b ? `${arg ? ", " : ""}${json.replace(/\n/g, "\n")}` : ""}${i ? `${b || arg ? ", " : ""}{ idempotencyKey: "${i}" }` : ""});\nconsole.log(${res}.status ?? ${res});`; }
  function pyCall(m: string, p: string, b: unknown, i?: string) { const [res, fn, arg] = sdkCall(p, m); return `${res} = momome.${snake(fn)}(${arg ? `"${arg}"` : ""}${b ? `${arg ? ", " : ""}${json.replace(/"([a-z_]+)":/g, '"$1":')}` : ""}${i ? `${b || arg ? ", " : ""}idempotency_key="${i}"` : ""})\nprint(${res}["status"] if isinstance(${res}, dict) else ${res})`; }
  function phpCall(m: string, p: string, b: unknown, i?: string, facade = false) { const [res, fn, arg] = sdkCall(p, m); const call = facade ? `MoMoMe::${fn}` : `$momome->${fn}`; return `$${res} = ${call}(${arg ? `'${arg}'` : ""}${b ? `${arg ? ", " : ""}${phpArr(b)}` : ""}${i ? `${b || arg ? ", " : ""}['idempotency_key' => '${i}']` : ""});\necho $${res}['status'] ?? json_encode($${res});`; }
}
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const phpArr = (v: unknown): string => Array.isArray(v) ? `[${v.map(phpArr).join(", ")}]` : v && typeof v === "object" ? `[${Object.entries(v as Record<string, unknown>).map(([k, x]) => `'${k}' => ${phpArr(x)}`).join(", ")}]` : typeof v === "string" ? `'${v}'` : String(v);
function sdkCall(path: string, method: string): [string, string, string | null] {
  if (path === "/quotes" && method === "POST") return ["quote", "quotes.create", null];
  if (path === "/payments" && method === "POST") return ["payment", "payments.create", null];
  if (path.startsWith("/payments/") && method === "GET") return ["payment", "payments.get", path.split("/")[2]];
  if (path.startsWith("/payments/") && path.endsWith("/cancel")) return ["payment", "payments.cancel", path.split("/")[2]];
  if (path === "/recipients/validate") return ["recipient", "recipients.validate", null];
  if (path === "/webhooks" && method === "POST") return ["endpoint", "webhooks.create", null];
  if (path.startsWith("/sandbox/payments/")) return ["payment", "sandbox.pay", path.split("/")[3]];
  if (path === "/settlements" && method === "POST") return ["settlement", "settlements.create", null];
  if (path === "/resolve") return ["party", "identities.resolve", null];
  if (path === "/payment-intents" && method === "POST") return ["intent", "paymentIntents.create", null];
  if (path === "/invoices" && method === "POST") return ["invoice", "invoices.create", null];
  if (path === "/payouts" && method === "POST") return ["payout", "payouts.create", null];
  return ["result", "request", null];
}

const NAV: Array<{ grp: string; items: Array<[string, string]> }> = [
  { grp: "Getting started", items: [["intro", "Introduction"], ["quickstart", "Quick start"], ["auth", "Authentication"], ["environments", "Sandbox & live"]] },
  { grp: "Guides", items: [["quote", "Create a quote"], ["payment", "Create a payment"], ["track", "Track a payment"], ["webhooks", "Webhooks"], ["idempotency", "Idempotency"], ["sandbox", "Sandbox scenarios"]] },
  { grp: "Connect", items: [["connect", "Identities & reach"], ["invoices", "Invoices, links & QR"], ["checkout", "Hosted checkout"], ["payouts", "Payouts & Lightning"]] },
  { grp: "Reference", items: [["reference", "API reference"], ["states", "Payment states"], ["errors", "Error reference"], ["countries", "Countries & assets"], ["sdks", "SDKs"], ["limits", "Rate limits"]] },
];

type Spec = { paths: Record<string, Record<string, { tags?: string[]; summary?: string; description?: string; operationId?: string; parameters?: Array<{ name: string; in: string; required?: boolean; description?: string }>; requestBody?: { content?: { "application/json"?: { example?: unknown } } }; responses?: Record<string, { description?: string }> }>>; webhooks?: Record<string, unknown>; components?: { schemas?: Record<string, unknown> } };

export function Developers() {
  const [active, setActive] = useState("intro");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [health, setHealth] = useState<{ assets?: Array<{ asset: string; network: string; status: string }>; countries?: Array<{ code: string; currency: string; operators: string[]; status: string }> } | null>(null);
  const base = V1_BASE.startsWith("http") ? V1_BASE : `${typeof window !== "undefined" ? window.location.origin : ""}${V1_BASE}`;
  useEffect(() => {
    void fetch(`${V1_BASE}/openapi.json`).then((r) => (r.ok ? r.json() : null)).then((s) => s && setSpec(s)).catch(() => {});
    void fetch(`${V1_BASE}/health`).then((r) => (r.ok ? r.json() : null)).then((h) => h && setHealth(h.data)).catch(() => {});
  }, []);
  const ids = useMemo(() => NAV.flatMap((g) => g.items.map(([id]) => id)), []);
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => { const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]; if (vis) setActive(vis.target.id); }, { rootMargin: "-10% 0px -70% 0px", threshold: [0, 0.5, 1] });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids, spec]);

  const quoteBody = { source: { asset: "USDT", network: "ETHEREUM" }, destination: { country: "CM", currency: "XAF", amount: "25000", phone: "+237670123456" } };
  const paymentBody = { quote_id: "q_mubsrd95gi3elw", reference: "ORDER-12345", recipient: { phone: "+237670123456", name: "Nana Jean Paul" }, metadata: { order_id: "12345" } };
  const webhookBody = { url: "https://example.com/momome/webhook", events: ["payment.completed", "payment.failed", "payment.refunded"] };

  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div className="dev">
        <SiteHeader />
        <header className="dev-hero">
          <span className="eyebrow">⚡ MoMo›Me Developers</span>
          <h1>Build African payments into your application.</h1>
          <p>One API for Bitcoin, Lightning and stablecoin-powered payouts into African Mobile Money. Create a quote, create a payment, get one webhook when it lands — MoMo›Me owns the liquidity, the FX and the Mobile Money rails.</p>
          <div className="row">
            <a className="btn btn-primary" href="#quickstart">Quick start</a>
            <Link className="btn btn-ghost" to="/developers/dashboard">Dashboard & API keys →</Link>
            <a className="btn btn-ghost" href={`${V1_BASE}/openapi.json`} target="_blank" rel="noreferrer">OpenAPI 3.1 ↗</a>
          </div>
        </header>

        <div className="dev-layout">
          <nav className="dev-nav" aria-label="API docs">{NAV.map((g) => <div key={g.grp}><div className="grp">{g.grp}</div>{g.items.map(([id, label]) => <a key={id} href={`#${id}`} className={active === id ? "on" : ""}>{label}</a>)}</div>)}</nav>

          <main className="dev-main">
            <section id="intro" className="dev-sec">
              <h2>Introduction</h2>
              <p>The fundamental abstraction is <b>digital value → MoMo›Me → local payment rail</b>. You never integrate a liquidity provider, a blockchain, an FX feed or a Mobile Money operator: you tell us what should arrive where, your customer pays the instruction we return, and the recipient's phone is credited.</p>
              <div className="step"><span className="n">1</span><span className="t"><b>Create a quote</b> — locks the exchange rate and every fee for a destination amount (XAF) or a source amount (BTC / USDT / USDC).</span></div>
              <div className="step"><span className="n">2</span><span className="t"><b>Create a payment</b> from the quote with the recipient's number — you get <code>payment_instructions</code>: a Lightning invoice, a Bitcoin address or an ERC-20 address, with a payment URI for a QR.</span></div>
              <div className="step"><span className="n">3</span><span className="t"><b>Receive <code>payment.completed</code></b> on your webhook (or poll <code>GET /payments/{"{id}"}</code>). Every step in between is a state you can also subscribe to.</span></div>
              <div className="callout"><b>Base URLs.</b> Production <code>{base}</code> with <code>mm_live_</code> credentials · Sandbox with <code>mm_test_</code> credentials (see <a href="#environments">Sandbox & live</a>). Every response is <code>{"{ data, meta }"}</code> or <code>{"{ error, meta }"}</code>; <code>meta.request_id</code> is safe to quote to support.</div>
            </section>

            <section id="quickstart" className="dev-sec">
              <h2>Quick start</h2>
              <p>Get a sandbox credential from the <Link to="/developers/dashboard">dashboard</Link> (instant, no verification), then run these three calls — from your terminal, or in the dashboard's <Link to="/developers/dashboard#overview">sandbox console</Link>, which sends them for you and shows what comes back.</p>
              <Tabs label="1 · Create a quote" samples={samples(base, "POST", "/quotes", quoteBody, "quote-1")} />
              <Tabs label="2 · Create the payment" samples={samples(base, "POST", "/payments", paymentBody, "order-12345")} />
              <Tabs label="3 · Sandbox: simulate the customer paying" samples={samples(base, "POST", "/sandbox/payments/pay_abc123/pay", null)} />
              <p>Within seconds the sandbox settles the payout and <code>payment.completed</code> reaches your webhook (register one in step 4 of the <a href="#webhooks">webhooks guide</a>) — the same sequence a real customer's wallet triggers in production.</p>
            </section>

            <section id="auth" className="dev-sec">
              <h2>Authentication</h2>
              <p>Every request carries a credential as a bearer token. Credentials belong to an <b>application</b> inside your <b>organization</b>; each has an environment, a label, optional scopes and an optional IP allow-list. The secret is shown once at creation — store it in your secret manager, never in code.</p>
              <Code label="Header">{`Authorization: Bearer mm_test_4f3a9c…   # sandbox\nAuthorization: Bearer mm_live_8b21e0…   # production`}</Code>
              <Params rows={[["quotes:write", "scope", "Create and read quotes"], ["payments:read / payments:write", "scope", "Read / create, cancel, retry payments"], ["refunds:write", "scope", "Refund a payment awaiting refund"], ["webhooks:manage", "scope", "Manage webhook endpoints"], ["settlements:read / settlements:write", "scope", "Settlements"], ["account:read · usage:read · recipients:validate", "scope", "Account, usage, recipient validation"]]} />
              <p>Rotate a credential from the dashboard with a grace period (the old secret keeps working for up to 24 h); revoke it to stop it at once. Enterprise credentials can additionally require an IP allow-list.</p>
            </section>

            <section id="environments" className="dev-sec">
              <h2>Sandbox & live</h2>
              <p>The sandbox is a full deployment against simulated rails: real quotes from real rates, real state machine, real webhooks — no money. <code>mm_test_</code> credentials work only there; <code>mm_live_</code> only in production. Use the wrong one and you get <code>401 environment_mismatch</code> with the right <code>base_url</code> in <code>details</code>, never a silent failure.</p>
              <Code label="Environments">{`Production   ${base}\nSandbox      ${spec ? (spec as unknown as { servers?: Array<{ url: string }> }).servers?.[1]?.url ?? "(see dashboard)" : "(see dashboard)"}`}</Code>
              <p>Live credentials are enabled by MoMo›Me once your organization is verified (KYB). Everything you build against the sandbox works unchanged in production: only the base URL and the credential change.</p>
            </section>

            <section id="quote" className="dev-sec">
              <h2>Create a quote</h2>
              <p>A quote prices one transfer and locks it for its validity window (Lightning ≈ 10 min; on-chain quotes are <code>estimate_only</code> and re-priced at confirmation). Give the amount on the destination (XAF to deliver) or on the source (asset to send).</p>
              <Params rows={[["source.asset", "BTC · USDT · USDC", "What your customer pays with"], ["source.network", "LIGHTNING · BITCOIN · ETHEREUM", "Required for stablecoins; BTC defaults to LIGHTNING"], ["source.amount", "string", "Amount of the asset (alternative to destination.amount)"], ["destination.country", "CM", "Destination country (see Countries)"], ["destination.currency", "XAF", "Optional; the country's currency"], ["destination.amount", "string", "XAF to deliver to the recipient"], ["destination.phone", "E.164", "Optional; validated now and used as the default recipient"]]} />
              <Tabs label="POST /quotes" samples={samples(base, "POST", "/quotes", quoteBody, "quote-1")} />
              <Code label="Response">{`{
  "data": {
    "id": "q_mubsrd95gi3elw", "object": "quote", "status": "active",
    "source": { "asset": "USDT", "network": "ETHEREUM", "amount": "45.980000" },
    "destination": { "country": "CM", "currency": "XAF", "amount": "25000" },
    "rate": { "pair": "USDT/XAF", "value": "551.20", "spread_bps": 150, "locked_until": "2026-09-21T10:15:00.000Z", "estimate_only": false },
    "fees": { "platform": { "amount": "375", "currency": "XAF" }, "network": { "payer_pays": true, "…": "…" }, "total": { "amount": "375", "currency": "XAF" } },
    "expires_at": "2026-09-21T10:15:00.000Z"
  },
  "meta": { "request_id": "req_5f1c9e2ab3d94c7e" }
}`}</Code>
            </section>

            <section id="payment" className="dev-sec">
              <h2>Create a payment</h2>
              <p>Turn a quote into a payment. The recipient's number is validated against the country's numbering plan and its operator; when an operator record exists the registered name is returned (and compared to <code>recipient.name</code> if you give one). The quote is consumed: one quote, one payment.</p>
              <Params rows={[["quote_id", "string", "An active quote of yours"], ["reference", "string ≤64", "Your own id — unique per organization; searchable"], ["recipient.phone", "E.164", "Mobile Money number"], ["recipient.name", "string", "Who you expect; a mismatch with the operator's record answers 409 recipient_unverified"], ["metadata", "object", "Up to 20 string values, returned on every read and webhook"], ["confirmation_token", "string", "From a 409 recipient_unverified, to confirm the recipient"]]} />
              <Tabs label="POST /payments" samples={samples(base, "POST", "/payments", paymentBody, "order-12345")} />
              <Code label="Response (201)">{`{
  "data": {
    "id": "pay_mubsrd9m1vapl7", "object": "payment", "reference": "ORDER-12345", "status": "AWAITING_PAYMENT",
    "recipient": { "phone": "+237670123456", "operator": "MTN", "name": "NANA JEAN PAUL", "name_verified": true },
    "payment_instructions": {
      "method": "erc20_address", "asset": "USDT", "network": "ETHEREUM", "amount": "45.980000",
      "code": "0x8f3…", "uri": "ethereum:0xdAC1…@1/transfer?address=0x8f3…&uint256=45980000", "expires_at": "…"
    },
    "timeline": { "created_at": "…", "payment_detected_at": null, "completed_at": null, "…": "…" },
    "livemode": false
  },
  "meta": { "request_id": "req_…" }
}`}</Code>
              <div className="callout"><b>Show the instruction to your customer</b> (the <code>uri</code> as a QR, the <code>code</code> for copy-paste) and wait for the webhook. Nothing else is required of you: conversion, routing to MTN or Orange, retries and failover are ours.</div>
            </section>

            <section id="track" className="dev-sec">
              <h2>Track a payment</h2>
              <Tabs label="GET /payments/{id}" samples={samples(base, "GET", "/payments/pay_mubsrd9m1vapl7", null)} />
              <p>Long-poll instead of tight polling: <code>GET /payments/{"{id}"}?wait=25&status=AWAITING_PAYMENT</code> returns the moment the status changes from the one you hold (or after 25 s). <code>GET /transactions/{"{id}"}</code> returns the full timeline — request, quote, payment, rail instruction, payout provider, ledger entries and webhook deliveries — for support and reconciliation.</p>
            </section>

            <section id="webhooks" className="dev-sec">
              <h2>Webhooks</h2>
              <p>Register an HTTPS endpoint and the event types you want (or <code>"*"</code>). Every delivery is a signed <code>POST</code>; reply 2xx within 10 seconds. Retries follow 1 s → 10 s → 1 min → 10 min → 1 h, then the event is dead-lettered and replayable from the dashboard or the API. Events are idempotent: de-duplicate on <code>X-MoMoMe-Event-Id</code>.</p>
              <Tabs label="POST /webhooks" samples={samples(base, "POST", "/webhooks", webhookBody, "wh-1")} />
              <Code label="Verify the signature (Node.js)">{`import crypto from "node:crypto";
export function verify(rawBody, signatureHeader, secret) {
  const t = /t=(\\d+)/.exec(signatureHeader)?.[1], v1 = /v1=([0-9a-f]+)/.exec(signatureHeader)?.[1];
  if (!t || !v1 || Math.abs(Date.now() - Number(t)) > 5 * 60_000) return false;
  const expect = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expect));
}`}</Code>
              <Code label="Event">{`{ "id": "evt_…", "object": "event", "type": "payment.completed", "created_at": "…", "livemode": true,
  "data": { "id": "pay_…", "reference": "ORDER-12345", "status": "COMPLETED", "…": "…" } }`}</Code>
              <Params rows={[["payment.created · payment.awaiting_payment", "event", "Created; instruction issued"], ["payment.detected · payment.confirmed", "event", "Funds seen; funds final"], ["payment.processing · payment.payout_submitted", "event", "Converting; handed to the Mobile Money provider"], ["payment.completed", "event", "The recipient has the money — the one you need"], ["payment.failed · payment.expired · payment.cancelled", "event", "Terminal without delivery"], ["payment.refunded · payment.manual_review", "event", "Refund open/settled; held for an operator"], ["settlement.created · settlement.completed · settlement.failed", "event", "Settlements"]]} />
            </section>

            <section id="idempotency" className="dev-sec">
              <h2>Idempotency</h2>
              <p>Every <code>POST</code> that creates or changes something requires an <code>Idempotency-Key</code> (any unique string ≤ 255 chars — your order id is a good one). A retry with the same key and the same body returns the original response with <code>Idempotent-Replayed: true</code>; the same key with a different body is refused with <code>409 idempotency_key_reused</code>; a retry that overtakes an in-flight original gets <code>409 idempotency_in_progress</code>. Keys are kept for 24 hours. A payment is never executed twice because of a network retry.</p>
            </section>

            <section id="sandbox" className="dev-sec">
              <h2>Sandbox scenarios</h2>
              <p>Pay a reserved recipient number to rehearse an outcome; any other valid number succeeds. <code>GET /sandbox/scenarios</code> lists them.</p>
              <Params rows={[["+237 670 000 001", "PAYMENT_FAILED", "Payout rejected on every provider → REFUNDED with refund.status = awaiting_destination; POST /payments/{id}/refund with a Lightning invoice"], ["+237 670 100 002", "MANUAL_REVIEW", "Held for an operator after the funds arrive"], ["+237 670 200 003", "INSUFFICIENT_LIQUIDITY", "503 at creation"], ["+237 670 300 004", "PROVIDER_UNAVAILABLE", "503 at creation"], ["+237 670 400 005", "PAYMENT_TIMEOUT", "The instruction expires in 60 s → EXPIRED"], ["+237 670 500 006", "PAYMENT_DELAYED", "Completes ~20 s after payment"], ["an expired quote", "QUOTE_EXPIRED", "410"], ["a reused Idempotency-Key", "DUPLICATE_PAYMENT", "Replay, or 409 on a different body"], ["+237 670 12", "INVALID_RECIPIENT", "422 recipient_invalid"]]} />
              <p><code>POST /sandbox/payments/{"{id}"}/pay</code> simulates the customer's wallet paying the instruction.</p>
            </section>

            <section id="connect" className="dev-sec">
              <h2>Identities & reach</h2>
              <p><b>Connect once. Pay anyone. Settle anywhere.</b> Every organization has a MoMo›Me Payment Identity (<code>mpi_…</code>) with aliases — phone numbers, emails, merchant codes, a Lightning Address — and a settlement profile. You say <i>"pay 100 000 XAF to Company B"</i>; MoMo›Me decides whether that is an instant ledger transfer (B is connected), a Lightning-funded payment, a stablecoin, or a Mobile Money collection — and settles B the way B asked.</p>
              <Tabs label="POST /resolve — is this party reachable?" samples={samples(base, "POST", "/resolve", { phone: "+237699000202" }, undefined)} />
              <Code label="Response">{`{ "data": { "reachable": true, "identity": "mpi_…", "identity_type": "business", "connected": true,
            "payment_capabilities": ["momo_me", "lightning", "stablecoin", "mobile_money"], "lightning_address": "237699000202@momome.xyz" } }`}</Code>
              <Tabs label="POST /payment-intents — pay a connected party" samples={samples(base, "POST", "/payment-intents", { payee: { identity: "mpi_…" }, amount: { value: "100000", currency: "XAF" }, purpose: { type: "invoice", reference: "INV-29381" } }, "inv-29381")} />
              <p>Then <code>POST /payment-intents/{"{id}"}/execute</code>. When both parties are connected and your balance covers it, the response is already <code>completed</code> with <code>settlement_status: settled</code> — no external rail, no Bitcoin, instant. Otherwise you get a funding instruction, exactly like a payment.</p>
              <Params rows={[["GET /identities/me", "identity", "Your MPI, aliases, settlement profile, balance"], ["POST /identities · POST /identities/{id}/aliases · PATCH /identities/{id}", "identity", "Branches, sub-merchants, customers you manage; settlement profile (mobile_money · momo_me · bank_transfer · lightning)"], ["POST /counterparties", "identity", "A party with no MoMo›Me presence yet; auto-linked when they join"], ["POST /payment-intents · …/execute · …/cancel", "payment", "The canonical intent; route_preview at creation, route_explanation at execution"]]} />
            </section>

            <section id="invoices" className="dev-sec">
              <h2>Invoices, payment links & QR</h2>
              <p>Every invoice, link, QR and request-to-pay owns one payment intent and one hosted checkout URL. An invoice is paid once, in full (<code>partial_payments: false</code>). A <b>request-to-pay</b> is an invoice with a known payer.</p>
              <Tabs label="POST /invoices" samples={samples(base, "POST", "/invoices", { kind: "invoice", amount: { value: "45000" }, description: "Order #4471", reference: "ORD-4471", due_date: "2026-10-15", payer: { name: "Someone", phone: "+237655000303" } }, "ord-4471")} />
              <Code label="Response">{`{ "data": { "id": "inv_…", "number": "MM-2026-1002", "status": "issued", "payment_intent": "pi_…",
            "payment_url": "https://www.momome.xyz/p/pi_…", "qr": { "text": "https://www.momome.xyz/p/pi_…" }, "accepted_methods": ["lightning", "stablecoin", "mobile_money", "momo_me"], "partial_payments": false } }`}</Code>
              <p>Listen for <code>invoice.paid</code> (and <code>payment.completed</code> / <code>settlement.completed</code> on the intent). <code>kind</code> is <code>invoice</code>, <code>payment_link</code> or <code>qr</code>; <code>POST /requests</code> creates a request-to-pay.</p>
            </section>

            <section id="checkout" className="dev-sec">
              <h2>Hosted checkout</h2>
              <p>Send the payer to <code>payment_url</code>. The page needs no account: it shows the payee, the amount, and only the methods the routing engine allows for that payee and amount; it renders the instruction (QR, copy, open-in-wallet), counts down, retires a lapsed Lightning invoice and offers a fresh one, and updates by itself until it says <b>Paid</b>. Embed it in an iframe or build your own on the same public endpoints:</p>
              <Params rows={[["GET /checkout/{intent}", "public", "Payee, amount, purpose, available methods, current execution"], ["POST /checkout/{intent}/pay { method, payer_phone?, payer_name? }", "public", "Start funding; returns payment_instructions"], ["GET /checkout/{intent}/status", "public", "Lightweight poll: status, settlement_status, has_instruction"]]} />
            </section>

            <section id="payouts" className="dev-sec">
              <h2>Payouts & Lightning enablement</h2>
              <p>From your MoMo›Me balance, pay any Mobile Money number or any Lightning Address in the world. You send XAF; MoMo›Me buys the sats, pays the address and reconciles — you never hold Bitcoin, run a node or see a channel. <code>lightning_send</code> is a capability flag on your identity, nothing more.</p>
              <Tabs label="POST /payouts" samples={samples(base, "POST", "/payouts", { amount: { value: "25000" }, destination: { lightning_address: "alice@wallet.com" }, reference: "PAYROLL-09" }, "payroll-09-alice")} />
              <p>Or <code>destination: {"{ phone: \"+237…\" }"}</code> for Mobile Money, or <code>{"{ identity: \"mpi_…\" }"}</code> to let MoMo›Me pick the recipient's own settlement destination. A payout that cannot be delivered is <code>reversed</code> and your balance is restored; events: <code>payout.created · processing · completed · failed · reversed</code>.</p>
            </section>

            <section id="reference" className="dev-sec">
              <h2>API reference</h2>
              <p>Generated from the live OpenAPI document. Every path below exists on <code>{base}</code>.</p>
              {!spec && <p className="muted">Loading the OpenAPI document…</p>}
              {spec && Object.entries(spec.paths).map(([path, ops]) => Object.entries(ops).map(([verb, op]) => (
                <div className="ep" key={`${verb} ${path}`}>
                  <div className="ep-head"><span className={`verb ${verb === "get" ? "get" : verb === "delete" ? "del" : "post"}`}>{verb.toUpperCase()}</span><span className="ep-path">/v1{path}</span><span className="ep-tag">{op.tags?.[0]}</span></div>
                  <div className="ep-desc"><b>{op.summary}</b>{op.description ? <> — {op.description}</> : null}</div>
                  <div className="ep-body">
                    {op.parameters?.length ? <div className="muted small">Parameters: {op.parameters.map((p) => <code key={p.name}>{p.in === "header" ? p.name : `${p.name}${p.required ? "" : "?"}`}</code>)}</div> : null}
                    {op.requestBody?.content?.["application/json"]?.example ? <Code label="Request">{JSON.stringify(op.requestBody.content["application/json"].example, null, 2)}</Code> : null}
                    <div className="muted small" style={{ marginTop: 8 }}>Responses: {Object.entries(op.responses ?? {}).map(([c, r]) => <span key={c}><code>{c}</code> {r.description} · </span>)}</div>
                  </div>
                </div>
              )))}
            </section>

            <section id="states" className="dev-sec">
              <h2>Payment states</h2>
              <Params rows={[["CREATED", "→", "Payment record exists"], ["AWAITING_PAYMENT", "→", "Instruction issued; waiting for your customer"], ["PAYMENT_DETECTED", "→", "Funds seen (mempool / HTLC held)"], ["PAYMENT_CONFIRMED", "→", "Funds final; rate locked"], ["CONVERSION_PROCESSING", "→", "Converting to XAF"], ["PAYOUT_PROCESSING", "→", "Routing to the Mobile Money provider"], ["PAYOUT_SUBMITTED", "→", "Provider accepted the payout"], ["COMPLETED", "✓", "The recipient has the money"], ["EXPIRED", "✕", "Never paid before the instruction expired"], ["CANCELLED", "✕", "Cancelled by you before funds arrived"], ["FAILED", "✕", "Terminal failure without funds"], ["REFUNDED", "↩", "Payout could not be delivered; funds returned (or awaiting your refund destination)"], ["MANUAL_REVIEW", "⏸", "Held for an operator (compliance); resolves to COMPLETED or REFUNDED"]]} />
              <p>Transitions are explicit and logged; a payment is never <code>COMPLETED</code> until the provider positively confirms the payout. MoMo›Me holds no funds after settlement, so a COMPLETED payment cannot be reversed through the API.</p>
            </section>

            <section id="errors" className="dev-sec">
              <h2>Error reference</h2>
              <Code label="Shape">{`{ "error": { "code": "quote_expired", "message": "This quote has expired. Create a new quote.", "details": {} }, "meta": { "request_id": "req_…" } }`}</Code>
              <Params rows={[["401 unauthorized · credential_revoked · environment_mismatch", "auth", "details.base_url on environment_mismatch"], ["403 forbidden_scope · organization_suspended · ip_not_allowed · compliance_blocked", "auth / risk", ""], ["400 idempotency_key_required · idempotency_key_invalid", "request", ""], ["409 idempotency_key_reused · idempotency_in_progress · quote_already_used · recipient_unverified · payment_not_cancellable · payment_not_refundable · insufficient_balance", "state", "recipient_unverified carries details.confirmation_token and registered_name"], ["410 quote_expired", "state", ""], ["422 validation_failed · asset_unsupported · network_unsupported · country_unsupported · currency_unsupported · amount_out_of_range · recipient_invalid · recipient_reserved · limit_exceeded", "validation", "details.field names the field"], ["404 quote_not_found · payment_not_found · webhook_not_found · settlement_not_found · not_found", "lookup", "Other organizations' objects are 404, never 403"], ["429 rate_limited", "throttle", "Retry-After header"], ["503 insufficient_liquidity · provider_unavailable · service_paused", "capacity", "Safe to retry later"]]} />
            </section>

            <section id="countries" className="dev-sec">
              <h2>Countries & assets</h2>
              <Params rows={(health?.countries ?? [{ code: "CM", currency: "XAF", operators: ["MTN", "ORANGE"], status: "live" }]).map((c) => [c.code, c.currency, `${c.operators.join(", ")} — ${c.status}`])} />
              <Params rows={(health?.assets ?? []).map((a) => [a.asset, a.network, a.status])} />
              <p>New countries, operators, assets and networks are configuration on our side — the API contract does not change when a corridor opens.</p>
            </section>

            <section id="sdks" className="dev-sec">
              <h2>SDKs</h2>
              <p>Thin clients generated from the OpenAPI document, so they never drift from the API: <code>@momome/sdk</code> (TypeScript / JavaScript), <code>momome-php</code> (PHP, with a Laravel facade) and <code>momome-python</code>. Each handles the bearer header, idempotency keys, the envelope and typed errors. See the <a href="https://github.com/chorimsky/MoMoMe/tree/main/sdk" target="_blank" rel="noreferrer">sdk/</a> directory.</p>
              <Code label="Install">{`npm i @momome/sdk        # TypeScript / JavaScript\ncomposer require momome/momome-php\npip install momome`}</Code>
            </section>

            <section id="limits" className="dev-sec">
              <h2>Rate limits</h2>
              <Params rows={[["Developer", "60 req/min", "15/min on payment endpoints"], ["Business", "300 req/min", "60/min on payment endpoints; volume tiers"], ["Enterprise", "custom", "IP allow-list, request signing, negotiated fee"]]} />
              <p>Limits are per organization and environment. Responses carry <code>X-RateLimit-Limit</code> and <code>X-RateLimit-Remaining</code>; a <code>429</code> carries <code>Retry-After</code>. Recipient validation is additionally capped at 300/hour.</p>
            </section>
          </main>
        </div>
        <SiteFooter />
      </div>
    </div>
  );
}

export function DevDocsLink({ children }: { children: ReactNode }) { return <Link to="/developers">{children}</Link>; }
