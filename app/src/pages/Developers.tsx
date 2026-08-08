/* ============================================================
   Developer API portal (/developers) — a clean, complete reference for the
   MoMo›Me settlement API. The live base URL + machine-readable spec come from
   GET /api/openapi.json (served by the backend), so the docs never drift.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SiteHeader, SiteFooter } from "../components/nav.js";
import { API_BASE } from "../api/client.js";
import "./Developers.css";

/** Live, keyless quote playground — POSTs to the real /quotes endpoint so
 *  developers see an actual response before writing a line of code. */
function TryIt({ base }: { base: string }) {
  const [xaf, setXaf] = useState(50000);
  const [method, setMethod] = useState("LIGHTNING");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; status: number; body: string } | null>(null);

  const run = async () => {
    setBusy(true); setOut(null);
    try {
      const r = await fetch(`${API_BASE}/quotes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xaf: Number(xaf) || 0, method, country: "CM" }),
      });
      const body = await r.json().catch(() => ({}));
      setOut({ ok: r.ok, status: r.status, body: JSON.stringify(body, null, 2) });
    } catch {
      setOut({ ok: false, status: 0, body: '{\n  "error": "network_error",\n  "message": "Could not reach the API."\n}' });
    } finally { setBusy(false); }
  };

  const field: React.CSSProperties = { padding: "10px 12px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 14, color: "var(--ink)", outline: "none" };
  return (
    <div className="tryit">
      <div className="tryit-form">
        <label>xaf<input type="number" min={500} step={500} value={xaf} onChange={(e) => setXaf(Number(e.target.value))} style={{ ...field, fontFamily: "var(--font-mono)" }} /></label>
        <label>method<select value={method} onChange={(e) => setMethod(e.target.value)} style={field}><option>LIGHTNING</option><option>ONCHAIN</option><option>USDT</option></select></label>
        <label>country<input value="CM" readOnly style={{ ...field, opacity: 0.7 }} /></label>
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy} style={{ alignSelf: "end", whiteSpace: "nowrap" }}>{busy ? "Running…" : "Run request →"}</button>
      </div>
      {out && (
        <div className="code" style={{ marginTop: 12 }}>
          <div className="bar"><span className="lbl">POST /quotes → <span style={{ color: out.ok ? "var(--recv)" : "var(--bad)" }}>{out.status || "—"} {out.ok ? "OK" : "Error"}</span></span></div>
          <pre><code>{out.body}</code></pre>
        </div>
      )}
      <p className="tryit-note">Calls the live <code>{base}/quotes</code> — no API key needed for quotes. Rate-limited to 60/min.</p>
    </div>
  );
}

const absBase = API_BASE.startsWith("http") ? API_BASE : `${typeof window !== "undefined" ? window.location.origin : ""}${API_BASE}`;

function Code({ label, children }: { label: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className="code">
      <div className="bar"><span className="lbl">{label}</span><button type="button" className="copy" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button></div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

function Endpoint({ verb, path, desc, children }: { verb: "GET" | "POST" | "DELETE"; path: string; desc: string; children?: React.ReactNode }) {
  const cls = verb === "GET" ? "get" : verb === "DELETE" ? "del" : "post";
  return (
    <div className="ep">
      <div className="ep-head"><span className={`verb ${cls}`}>{verb}</span><span className="ep-path">{path}</span></div>
      <div className="ep-desc">{desc}</div>
      {children && <div className="ep-body">{children}</div>}
    </div>
  );
}

function Params({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <div className="tbl">
      <div className="r h"><span>Field</span><span>Type</span><span>Description</span></div>
      {rows.map(([nm, ty, ds]) => (
        <div className="r" key={nm}><span className="nm">{nm}</span><span className="ty">{ty}</span><span className="ds">{ds}</span></div>
      ))}
    </div>
  );
}

const NAV: Array<{ grp: string; items: Array<[string, string]> }> = [
  { grp: "Getting started", items: [["intro", "Introduction"], ["auth", "Authentication"], ["quickstart", "Quickstart"], ["playground", "Try it"]] },
  { grp: "Endpoints", items: [["quote", "Create a quote"], ["payment", "Create a payment"], ["get", "Get a payment"], ["resolve", "Resolve a number"]] },
  { grp: "Reference", items: [["lifecycle", "Payment lifecycle"], ["errors", "Errors"], ["limits", "Rate limits"], ["spec", "OpenAPI spec"]] },
];

export function Developers() {
  const [active, setActive] = useState("intro");
  const [base, setBase] = useState(absBase);

  useEffect(() => { document.title = "MoMo›Me API — Developer documentation"; }, []);

  // Pull the authoritative base URL from the live spec (never drifts from prod).
  useEffect(() => {
    void fetch(`${API_BASE}/openapi.json`).then((r) => (r.ok ? r.json() : null)).then((spec) => {
      const u = spec?.servers?.[0]?.url;
      if (typeof u === "string" && u.startsWith("http")) setBase(u);
    }).catch(() => {});
  }, []);

  // Scroll-spy for the sidebar active state.
  const ids = useMemo(() => NAV.flatMap((g) => g.items.map(([id]) => id)), []);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => { const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]; if (vis) setActive(vis.target.id); },
      { rootMargin: "-10% 0px -70% 0px", threshold: [0, 0.5, 1] },
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids]);

  const curlQuote = `curl -X POST ${base}/quotes \\
  -H "Authorization: Bearer mk_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "xaf": 50000, "method": "LIGHTNING", "country": "CM" }'`;

  const curlPayment = `curl -X POST ${base}/payments \\
  -H "Authorization: Bearer mk_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "quoteId": "qt_9f2c…",
    "recipient": { "phone": "677000789", "country": "CM", "provider": "MTN", "name": "NANA JEAN" }
  }'`;

  const curlGet = `curl ${base}/payments/pay_a1b2c3 \\
  -H "Authorization: Bearer mk_live_your_key"`;

  return (
    <div className="app-bg" style={{ background: "var(--paper)" }}>
      <div className="dev">
        <SiteHeader />

        <header className="dev-hero">
          <span className="eyebrow">⚡ Developer API</span>
          <h1>Crypto → Mobile Money, in one API call.</h1>
          <p>
            Accept Bitcoin, Lightning or stablecoins and settle instantly to any MTN or Orange Money number across
            Cameroon & CEMAC. Create a quote, create a payment, get paid in crypto, and MoMo›Me delivers the
            local-currency payout — no exchange, no float to manage.
          </p>
          <div className="row">
            <a className="btn btn-primary" href="#quickstart">Quickstart</a>
            <a className="btn btn-ghost" href={`${API_BASE}/openapi.json`} target="_blank" rel="noreferrer">OpenAPI spec ↗</a>
          </div>
        </header>

        <div className="dev-layout">
          <nav className="dev-nav" aria-label="API docs">
            {NAV.map((g) => (
              <div key={g.grp}>
                <div className="grp">{g.grp}</div>
                {g.items.map(([id, label]) => (
                  <a key={id} href={`#${id}`} className={active === id ? "on" : ""}>{label}</a>
                ))}
              </div>
            ))}
          </nav>

          <main className="dev-main">
            <section id="intro" className="dev-sec">
              <h2>Introduction</h2>
              <p>
                The MoMo›Me API is a settlement layer: your customer pays you in crypto, and we pay out real Mobile
                Money. Every payment follows the same four steps:
              </p>
              <div className="step"><span className="n">1</span><span className="t"><b>Create a quote</b> — lock an exchange rate for the payout amount (XAF) and crypto rail.</span></div>
              <div className="step"><span className="n">2</span><span className="t"><b>Create a payment</b> from that quote with the recipient's Mobile Money number. You get back a <code>payInstruction</code> — a Lightning invoice, or an on-chain Bitcoin / Ethereum ERC-20 (USDT) address.</span></div>
              <div className="step"><span className="n">3</span><span className="t"><b>Pay the instruction</b> in crypto (your wallet, your customer, or your own rails).</span></div>
              <div className="step"><span className="n">4</span><span className="t"><b>Poll the payment</b> (or receive a webhook) until <code>state</code> is <code>DELIVERED</code>. The payout lands on the recipient's phone in seconds.</span></div>
              <div className="callout"><b>Base URL.</b> All endpoints live under <code>{base}</code>. Requests and responses are JSON. Amounts in XAF are integers.</div>
            </section>

            <section id="auth" className="dev-sec">
              <h2>Authentication</h2>
              <p>
                Authenticate every request with your secret API key. Send it as a bearer token or an
                <code> X-API-Key</code> header. Keys are issued from your MoMo›Me admin console (Super-Admin → Developers)
                and shown only once at creation — store it securely and never expose it in client-side code.
              </p>
              <Code label="Authorization header">{`Authorization: Bearer mk_live_xxxxxxxxxxxxxxxxxxxx`}</Code>
              <Code label="…or X-API-Key">{`X-API-Key: mk_live_xxxxxxxxxxxxxxxxxxxx`}</Code>
              <div className="callout"><b>Isolation.</b> A key only ever sees the payments it created. A missing or invalid key returns <code>401 unauthorized</code>.</div>
            </section>

            <section id="quickstart" className="dev-sec">
              <h2>Quickstart</h2>
              <p>Send 50,000 XAF to an MTN number, paid over Lightning — end to end:</p>
              <h3>1 — Create a quote</h3>
              <Code label="cURL">{curlQuote}</Code>
              <h3>2 — Create the payment</h3>
              <p>Use the <code>id</code> from the quote, and pay the <code>payInstruction</code> it returns.</p>
              <Code label="cURL">{curlPayment}</Code>
              <h3>3 — Track it to delivery</h3>
              <Code label="cURL">{curlGet}</Code>
            </section>

            <section id="playground" className="dev-sec">
              <h2>Try it</h2>
              <p>Run a real quote against the live API right now — pick an amount and a rail, and see the exact JSON your integration will receive.</p>
              <TryIt base={base} />
            </section>

            <section id="quote" className="dev-sec">
              <h2>Create a quote</h2>
              <Endpoint verb="POST" path="/quotes" desc="Locks the FX rate for a payout. The quote expires — create the payment before expiresAt.">
                <Params rows={[
                  ["xaf", "integer", "Amount delivered to the recipient, in XAF (≥ 500)."],
                  ["method", "string", "Inbound crypto rail: LIGHTNING · ONCHAIN · USDT."],
                  ["country", "string", "Recipient country (CEMAC): CM · GA · TD · CG · CF."],
                ]} />
                <Code label="Response 200">{`{
  "id": "qt_9f2c…",
  "xaf": 50000,
  "feeXaf": 1250,
  "totalXaf": 51250,
  "method": "LIGHTNING",
  "inboundAsset": "BTC",
  "inboundAmount": 0.00082,
  "inboundAmountLabel": "82 000 sats",
  "rate": 62500000,
  "usd": 84.38,
  "expiresAt": "2026-08-05T12:34:00.000Z",
  "estimateOnly": false
}`}</Code>
              </Endpoint>
            </section>

            <section id="payment" className="dev-sec">
              <h2>Create a payment</h2>
              <Endpoint verb="POST" path="/payments" desc="Creates a payment from a quote and returns the crypto pay instruction. Pay it, and the Mobile Money payout is delivered automatically once the inbound confirms.">
                <Params rows={[
                  ["quoteId", "string", "id from Create a quote (must not be expired)."],
                  ["recipient.phone", "string", "Local Mobile Money number, e.g. 677000789."],
                  ["recipient.country", "string", "CEMAC country code."],
                  ["recipient.provider", "string", "MTN or ORANGE."],
                  ["recipient.name", "string", "Recipient's name (shown on the payout)."],
                ]} />
                <Code label="Response 200">{`{
  "id": "pay_a1b2c3",
  "ref": "MMM-2026-418842",
  "state": "AWAITING_INBOUND",
  "displayStatus": "Pending",
  "method": "LIGHTNING",
  "xaf": 50000, "feeXaf": 1250, "totalXaf": 51250,
  "payInstruction": {
    "method": "LIGHTNING",
    "code": "lnbc820u1p…",        // pay this
    "qr": "lnbc820u1p…",
    "asset": "BTC",
    "amount": 0.00082,
    "amountLabel": "82 000 sats",
    "expiresAt": "2026-08-05T12:39:00.000Z"
  },
  "createdAt": "2026-08-05T12:34:10.000Z"
}`}</Code>
              </Endpoint>
            </section>

            <section id="get" className="dev-sec">
              <h2>Get a payment</h2>
              <Endpoint verb="GET" path="/payments/{id}" desc="Returns the current state of a payment you created. Poll every few seconds until state is DELIVERED, REFUNDED or FAILED.">
                <Code label="Response 200">{`{
  "id": "pay_a1b2c3",
  "ref": "MMM-2026-418842",
  "state": "DELIVERED",
  "displayStatus": "Completed",
  "xaf": 50000,
  "recipient": { "phone": "677000789", "provider": "MTN", "name": "NANA JEAN" },
  "updatedAt": "2026-08-05T12:34:41.000Z"
}`}</Code>
              </Endpoint>
            </section>

            <section id="resolve" className="dev-sec">
              <h2>Resolve a number</h2>
              <Endpoint verb="GET" path="/recipients/resolve?phone={number}&country=CM" desc="Detects the operator (MTN/Orange) for a Mobile Money number and, when available, the account holder's name — handy for confirming before you pay.">
                <Code label="Response 200">{`{ "status": "provider", "name": "NANA JEAN PAUL", "provider": "MTN" }`}</Code>
              </Endpoint>
            </section>

            <section id="lifecycle" className="dev-sec">
              <h2>Payment lifecycle</h2>
              <p>A payment moves through these states. Watch <code>state</code> (fine-grained) or <code>displayStatus</code> (Completed / Pending / Failed):</p>
              <ul>
                <li><code>AWAITING_INBOUND</code> — waiting for your crypto payment to the instruction.</li>
                <li><code>INBOUND_CONFIRMED → FX_LOCKED</code> — crypto received, rate settled.</li>
                <li><code>PAYOUT_REQUESTED → DELIVERED</code> — Mobile Money sent and confirmed. ✅ Terminal, success.</li>
                <li><code>REFUND_PENDING → REFUNDED</code> — payout couldn't land; the inbound is returned.</li>
                <li><code>FAILED</code> / <code>MANUAL_REVIEW</code> — needs attention (e.g. underpaid inbound).</li>
              </ul>
              <div className="callout"><b>Webhooks.</b> Prefer push over polling? Ask your account manager to enable payment-status webhooks for your key — we POST the full payment object to your URL on every state change.</div>
            </section>

            <section id="errors" className="dev-sec">
              <h2>Errors</h2>
              <p>Errors use standard HTTP status codes and a JSON body with a stable machine <code>error</code> code plus a human <code>message</code>.</p>
              <Code label="Error shape">{`{ "error": "quote_expired", "message": "That quote has expired. Please request a new one." }`}</Code>
              <div className="tbl">
                <div className="r h"><span>Status</span><span>Code</span><span>Meaning</span></div>
                <div className="r"><span className="nm">400</span><span className="ty">bad_amount</span><span className="ds">Amount out of range or malformed request.</span></div>
                <div className="r"><span className="nm">401</span><span className="ty">unauthorized</span><span className="ds">Missing or invalid API key.</span></div>
                <div className="r"><span className="nm">404</span><span className="ty">not_found</span><span className="ds">Payment doesn't exist or isn't yours.</span></div>
                <div className="r"><span className="nm">409</span><span className="ty">quote_expired</span><span className="ds">The quote expired before the payment was created.</span></div>
                <div className="r"><span className="nm">429</span><span className="ty">rate_limited</span><span className="ds">Too many requests — slow down (see Rate limits).</span></div>
                <div className="r"><span className="nm">503</span><span className="ty">rates_unavailable</span><span className="ds">FX feed temporarily unavailable — retry shortly.</span></div>
              </div>
            </section>

            <section id="limits" className="dev-sec">
              <h2>Rate limits</h2>
              <p>Limits are per-IP, per-minute. Exceeding one returns <code>429</code>; retry after the window.</p>
              <div className="tbl">
                <div className="r h"><span>Endpoint</span><span>Limit</span><span>Window</span></div>
                <div className="r"><span className="nm">POST /quotes</span><span className="ty">60</span><span className="ds">per minute</span></div>
                <div className="r"><span className="nm">POST /payments</span><span className="ty">30</span><span className="ds">per minute</span></div>
                <div className="r"><span className="nm">GET /recipients/resolve</span><span className="ty">120</span><span className="ds">per minute</span></div>
              </div>
            </section>

            <section id="spec" className="dev-sec">
              <h2>OpenAPI spec</h2>
              <p>
                The full machine-readable specification (OpenAPI 3.1) is served live — import it into Postman, Insomnia,
                or a code generator to scaffold a typed client in minutes.
              </p>
              <Code label="Fetch the spec">{`curl ${base}/openapi.json`}</Code>
              <div className="row" style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <a className="btn btn-primary" href={`${API_BASE}/openapi.json`} target="_blank" rel="noreferrer">Open the spec ↗</a>
                <Link className="btn btn-ghost" to="/contact">Talk to us about keys</Link>
              </div>
            </section>
          </main>
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
