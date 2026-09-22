/* ============================================================
   Hosted checkout (/p/:intentId) — MoMo›Me Connect (docs/connect §28–29).
   The payer holds nothing but the link: no account, no credential. The page reads the
   intent through the public checkout endpoints, offers the methods the routing engine
   allows for this payee and amount, shows the instruction to pay (QR + copy), and follows
   the status until the payee is settled. Every surface — invoice, payment link, QR,
   request-to-pay — lands here because they all reference one Payment Intent.
   ============================================================ */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { QR, CopyField, Spinner } from "../components/atoms.js";
import { V1_BASE } from "../api/developers.js";
import "./Developers.css";
import "./developers/dashboard.css";

type Checkout = { id: string; status: string; settlement_status: string; payee: { display_name: string; type: string | null; verified: boolean }; amount: { value: string; currency: string }; purpose: { type: string; reference?: string; description?: string }; methods: string[]; execution: { method: string; payment_id: string | null; payment_instructions: { method: string; code?: string; uri?: string; amount?: string; amount_label?: string; expires_at?: string; message?: string } | null } | null; expires_at: string; livemode: boolean };
const METHOD_COPY: Record<string, [string, string]> = { lightning: ["Bitcoin Lightning", "Pay the invoice from any Lightning wallet — settles in seconds."], stablecoin: ["USDT / USDC", "Send stablecoins on Ethereum to the address shown."], mobile_money: ["Mobile Money", "Approve the request on your phone (MTN or Orange)."] };
const fmt = (n: string | number) => Number(n).toLocaleString("en");

export function Checkout() {
  const { id = "" } = useParams();
  const [c, setC] = useState<Checkout | null>(null); const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState<string>(""); const [phone, setPhone] = useState(""); const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const load = async () => { let r: Response; try { r = await fetch(`${V1_BASE}/checkout/${id}`); } catch { setErr("Network error — check your connection and reload."); return; } const j = await r.json().catch(() => ({})); if (!r.ok) { setErr(j.error?.message ?? "This payment link is not available right now."); return; } setC((prev) => ({ ...j.data, retried: !!prev?.execution && !j.data.execution })); if (!method && j.data.methods?.length) setMethod(j.data.methods[0]); };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow the status while something is in flight.
  useEffect(() => {
    if (!c || ["completed", "failed", "expired", "reversed"].includes(c.status) || !c.execution) return;
    const t = setInterval(async () => { try { const r = await fetch(`${V1_BASE}/checkout/${id}/status`); const j = await r.json().catch(() => ({})); if (j.data && (j.data.status !== c.status || j.data.settlement_status !== c.settlement_status || j.data.has_instruction === false)) void load(); } catch { /* next tick */ } }, 2000);
    return () => clearInterval(t);
  }, [c?.status, c?.settlement_status, c?.execution?.payment_id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Countdown on the funding instruction; when it lapses the page reloads and offers a new one.
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => { const exp = c?.execution?.payment_instructions?.expires_at; if (!exp) { setLeft(null); return; } const tick = () => { const s = Math.max(0, Math.round((Date.parse(exp) - Date.now()) / 1000)); setLeft(s); if (s === 0) void load(); }; tick(); const t = setInterval(tick, 1000); return () => clearInterval(t); }, [c?.execution?.payment_instructions?.expires_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const STEPS = ["pending", "authorized", "processing", "completed"]; const stepIdx = Math.max(0, STEPS.indexOf(c?.status ?? "pending"));
  const pay = async () => { setBusy(true); setErr(null); try { const r = await fetch(`${V1_BASE}/checkout/${id}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, payer_phone: phone || undefined, payer_name: name || undefined }) }); const j = await r.json(); if (!r.ok) setErr(j.error?.message ?? "Could not start the payment."); else setC(j.data); } catch { setErr("Network error — try again."); } finally { setBusy(false); } };
  if (err && !c) return <Shell><div className="dd-auth-card"><h1>Payment link</h1><div className="dd-err">{err}</div></div></Shell>;
  if (!c) return <Shell><div className="dd-auth-card"><Spinner /> Loading…</div></Shell>;
  const done = c.status === "completed"; const dead = ["failed", "expired", "reversed"].includes(c.status);
  const ins = c.execution?.payment_instructions;
  return (
    <Shell>
      <div className="dd-auth-card" style={{ width: "min(520px, 100%)" }}>
        <span className="eyebrow">{c.livemode ? "Secure payment" : "Sandbox payment"}</span>
        <h1 style={{ fontSize: 22 }}>Pay {fmt(c.amount.value)} {c.amount.currency}</h1>
        <p className="muted">to <b>{c.payee.display_name}</b>{c.payee.verified ? " ✓" : ""}{c.purpose.description ? ` — ${c.purpose.description}` : ""}{c.purpose.reference ? ` (${c.purpose.reference})` : ""}</p>
        {done && <div className="callout" role="status"><b>Paid.</b> {c.settlement_status === "settled" ? `${c.payee.display_name} has received the money.` : "The payment is confirmed; settlement is in progress."}</div>}
        {dead && <div className="dd-err" role="alert">This payment is {c.status}. Ask {c.payee.display_name} for a new link.</div>}
        {!done && !dead && !ins && (
          <div className="dd-form">
            {c.status === "created" && (c as Checkout & { retried?: boolean }).retried && <div className="callout small">The previous payment code expired unpaid. Choose a method to get a fresh one.</div>}
            <div className="dd-plans" role="radiogroup" aria-label="Payment method">{c.methods.map((m) => <label key={m} className={method === m ? "on" : ""}><input type="radio" name="m" checked={method === m} onChange={() => setMethod(m)} /><b>{METHOD_COPY[m]?.[0] ?? m}</b><span>{METHOD_COPY[m]?.[1] ?? ""}</span></label>)}</div>
            {method === "mobile_money" && <label>Your Mobile Money number<input inputMode="tel" placeholder="+237 6XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>}
            <label>Your name (optional)<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            {err && <div className="dd-err" role="alert">{err}</div>}
            <button type="button" className="btn btn-primary btn-block" disabled={busy || !method || (method === "mobile_money" && !phone)} onClick={pay}>{busy ? "…" : `Pay with ${METHOD_COPY[method]?.[0] ?? method}`}</button>
            {!c.methods.length && <div className="dd-empty">No payment method is available for this link right now.</div>}
          </div>
        )}
        {!done && !dead && ins && (
          <div className="dd-form">
            {ins.uri && <div style={{ display: "grid", placeItems: "center" }}><QR value={ins.uri} size={200} /></div>}
            {ins.code && <CopyField value={ins.code} label={ins.method === "lightning_invoice" ? "Lightning invoice" : ins.method === "erc20_address" ? "Address (Ethereum)" : "Payment code"} />}
            {ins.uri && <a className="btn btn-primary btn-block" href={ins.uri}>{ins.method === "lightning_invoice" ? "Open in a Lightning wallet" : "Open in a wallet"}</a>}
            {ins.amount_label && <p className="muted small">Send exactly <b>{ins.amount_label}</b>{left !== null ? <> · <b>{left > 0 ? `${mmss(left)} left` : "expired"}</b></> : ""}</p>}
            {ins.message && <p className="muted">{ins.message}</p>}
            <ol className="dd-stages" aria-label="Progress">{["Waiting for payment", "Payment seen", "Confirming & paying out", "Done"].map((label, i) => <li key={label} className={i < stepIdx ? "done" : i === stepIdx ? "now" : ""}><span>{i < stepIdx ? "✓" : i + 1}</span>{label}</li>)}</ol>
            <p className="muted small"><Spinner size={14} /> This page updates by itself — keep it open until it says <b>Paid</b>.</p>
            {!c.livemode && c.execution?.payment_id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => fetch(`/api/payments/${c.execution!.payment_id}/simulate`, { method: "POST", headers: { "content-type": "application/json", "x-mm-sender": `connect:${c.id}` } }).then(() => load())}>Sandbox: simulate paying</button>}
          </div>
        )}
        <p className="muted small" style={{ marginTop: 14 }}>Powered by <Link to="/">MoMo›Me</Link> · the payee never sees your wallet; you never need an account.</p>
      </div>
    </Shell>
  );
}
function Shell({ children }: { children: React.ReactNode }) { return <div className="app-bg" style={{ background: "var(--paper)", minHeight: "100vh" }}><div className="dev"><div className="dd-auth">{children}</div></div></div>; }
