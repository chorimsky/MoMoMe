/* ============================================================
   /wallet — an embedded, self-custodial Lightning wallet (Wavelength SDK).
   An ALTERNATIVE Lightning rail alongside IBEX: no node, channels or liquidity
   to manage — the wallet daemon runs in the browser (wasm).

   This route is a cross-origin-ISOLATED island: the wallet needs SharedArrayBuffer,
   which requires COOP/COEP headers (served only on /wallet — see vite.config.ts and
   the Hostinger .htaccess). Because that isolation would block the cross-origin map
   tiles on /discover, /wallet is entered and left via FULL page loads (plain <a>),
   never client-side <Link>, so the isolation never leaks across routes.

   Phase 1: signet (test network). Mainnet is gated by Lightning Labs approval +
   a key-backup UX (allowMainnet) — a later phase.
   ============================================================ */
import { useState } from "react";
import { createWebWalletEngine, defaultConfig } from "@lightninglabs/wavelength-web";
import type { Balance } from "@lightninglabs/wavelength-core";
import {
  WavelengthProvider, useWallet, useWalletBalance, useWalletReceive,
  useWalletSend, useWalletCreate, useWalletUnlock, useWalletActivity,
} from "@lightninglabs/wavelength-react";
import { Logo, QR, Spinner } from "../components/atoms.js";

// The wasm worker resolves each runtime asset with `new URL(name, runtimeBaseUrl)`,
// which requires an ABSOLUTE base — a root-relative path throws and importScripts
// then falls back to index.html ("Unexpected token '<'"). Resolve against the origin.
const RUNTIME_BASE =
  typeof window === "undefined"
    ? "/wavewalletdk/v0.1.1/"
    : new URL("/wavewalletdk/v0.1.1/", window.location.origin).href;

/** Create the wasm wallet engine once (this whole module is lazy-loaded, so it only
 *  boots when /wallet is actually opened). */
let _engine: ReturnType<typeof createWebWalletEngine> | null = null;
function walletEngine() {
  if (!_engine) {
    _engine = createWebWalletEngine({
      runtimeBaseUrl: RUNTIME_BASE,
      // Self-host the worker instead of the SDK's `new Worker(new URL(...))` — that
      // resolves to Vite's pre-bundled-dep worker URL, which the dev server serves as
      // HTML (Vite can't emit a worker from inside an optimized dep). The standalone
      // classic worker is copied next to the runtime by fetch-wavelength-runtime.sh.
      workerURL: RUNTIME_BASE + "wavewalletdk-worker.js",
      config: defaultConfig("signet"),
      autoStart: true,
    });
  }
  return _engine;
}

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: 18 };
const input: React.CSSProperties = { width: "100%", padding: "12px 13px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 15, color: "var(--ink)", outline: "none" };

export function Wallet() {
  const isolated = typeof window === "undefined" || window.crossOriginIsolated;
  return (
    <div className="app-bg" style={{ background: "var(--paper)", minHeight: "100dvh" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 48px" }}>
        {/* Full-nav header (plain <a>) so this stays an isolated island. */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0 16px" }}>
          <a href="/" aria-label="MoMo›Me — home" style={{ textDecoration: "none", display: "inline-flex" }}><Logo size={30} /></a>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: "var(--warn-ink)", background: "var(--send-wash)", border: "1px solid var(--warn)", padding: "4px 10px", borderRadius: 999 }}>⚡ signet · beta</span>
        </header>

        <h1 style={{ fontSize: "clamp(24px,5vw,30px)", letterSpacing: "-0.02em" }}>Lightning wallet</h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 18px", lineHeight: 1.55 }}>
          A self-custodial Lightning wallet that runs in your browser — an alternative rail alongside the settlement engine. No node or channels to manage.
        </p>

        {!isolated ? <IsolationHelp /> : (
          <WavelengthProvider engine={walletEngine()}>
            <WalletInner />
          </WavelengthProvider>
        )}
      </div>
    </div>
  );
}

/** Shown if the page wasn't loaded cross-origin-isolated (e.g. reached via a client-side
 *  link instead of a fresh load). A hard reload picks up the COOP/COEP headers. */
function IsolationHelp() {
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Open the wallet in a fresh tab</div>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.55 }}>
        The wallet needs a cross-origin-isolated context (for secure in-browser storage). Reload this page to enable it.
      </p>
      <a href="/wallet" className="btn btn-primary" style={{ marginTop: 14, textDecoration: "none", display: "inline-flex" }}>Reload wallet</a>
    </div>
  );
}

function WalletInner() {
  const { phase, error } = useWallet();
  const balance = useWalletBalance();

  // Wallet lifecycle (see RuntimePhase): 'ready'/'syncing' → unlocked & usable;
  // 'needsWallet' → first run (create); 'locked' → wallet exists (unlock); the
  // rest ('loading'/'runtimeReady'/'starting'/'restoring') are the wasm booting.
  const open = phase === "ready" || phase === "syncing";
  const needsWallet = phase === "needsWallet";
  const locked = phase === "locked";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Status */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
        {open
          ? <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--recv)", flex: "none" }} />
          : <Spinner size={16} color="var(--accent)" />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 650 }}>{statusLabel(phase)}</div>
          <div className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>phase: {phase}{error ? ` · ${String(error.message ?? error).slice(0, 60)}` : ""}</div>
        </div>
      </div>

      {/* Balance */}
      {open && (
        <div style={{ ...card }}>
          <div className="overline">Balance</div>
          <div className="num" style={{ fontSize: 30, fontWeight: 750, letterSpacing: "-0.02em", marginTop: 4 }}>
            {balance ? fmtSats(spendableSats(balance)) : "—"} <span style={{ fontSize: 15, color: "var(--ink-3)" }}>sats</span>
          </div>
          {balance && balance.pendingInSat > 0
            ? <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>+{fmtSats(balance.pendingInSat)} sats incoming</div>
            : null}
        </div>
      )}

      {needsWallet && <CreateWallet />}
      {locked && <UnlockWallet />}

      {open && <Receive />}
      {open && <Send />}
    </div>
  );
}

/** First run: create a fresh self-custodial wallet, encrypted with a password
 *  that never leaves the device. */
function CreateWallet() {
  const { create, createPending, createError } = useWalletCreate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw2.length > 0 && pw !== pw2;
  const canCreate = pw.length >= 8 && pw === pw2 && !createPending;
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Create your wallet</div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>A new self-custodial wallet on signet. Your keys stay on this device — the password encrypts them and is never sent anywhere.</p>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password (min 8 characters)" autoComplete="new-password" style={input} />
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm password" autoComplete="new-password" style={input} />
      </div>
      {mismatch ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>Passwords don't match.</div> : null}
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!canCreate} onClick={() => { void create({ password: pw }); }}>
        {createPending ? <Spinner size={15} color="var(--accent-ink)" /> : "Create wallet"}
      </button>
      {createError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(createError.message ?? createError).slice(0, 120)}</div> : null}
    </div>
  );
}

/** A wallet already exists on this device — unlock it with its password. */
function UnlockWallet() {
  const { unlock, unlockPending, unlockError } = useWalletUnlock();
  const [pw, setPw] = useState("");
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Unlock your wallet</div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>Enter the password you set when you created this wallet.</p>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" style={{ ...input, marginTop: 12 }}
        onKeyDown={(e) => { if (e.key === "Enter" && pw && !unlockPending) void unlock({ password: pw }); }} />
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!pw || unlockPending} onClick={() => { void unlock({ password: pw }); }}>
        {unlockPending ? <Spinner size={15} color="var(--accent-ink)" /> : "Unlock"}
      </button>
      {unlockError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(unlockError.message ?? unlockError).slice(0, 120)}</div> : null}
    </div>
  );
}

/** Generate a Lightning invoice to receive a payment, shown as a branded QR. */
function Receive() {
  const { receive, receivePending, receiveError } = useWalletReceive();
  const activity = useWalletActivity();
  const [sats, setSats] = useState("10000");
  const [memo, setMemo] = useState("");
  const [invoice, setInvoice] = useState<string | null>(null);

  const gen = async () => {
    const amt = Number(sats.replace(/\D/g, "")) || 0;
    if (amt <= 0) return;
    const r = await receive({ amountSat: amt, memo: memo.trim() || undefined });
    setInvoice((r as { invoice?: string })?.invoice ?? null);
  };
  const paid = invoice ? activity.some((e) => (e as { kind?: string; request?: { lightningInvoice?: string }; status?: string }).kind === "receive" && (e as { request?: { lightningInvoice?: string } }).request?.lightningInvoice === invoice && (e as { status?: string }).status === "settled") : false;

  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Receive</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={sats} onChange={(e) => setSats(e.target.value)} inputMode="numeric" placeholder="Amount (sats)" style={{ ...input, flex: "1 1 130px", fontFamily: "var(--font-mono)" }} />
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Note (optional)" maxLength={80} style={{ ...input, flex: "1 1 150px" }} />
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={receivePending} onClick={() => { void gen(); }}>
        {receivePending ? <Spinner size={15} color="var(--accent-ink)" /> : "Generate invoice"}
      </button>
      {receiveError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(receiveError).slice(0, 120)}</div> : null}
      {invoice && (
        <div style={{ display: "grid", placeItems: "center", marginTop: 16, gap: 10 }}>
          <div style={{ background: "#fff", padding: 12, borderRadius: 14 }}><QR value={`lightning:${invoice}`} size={200} /></div>
          {paid
            ? <div style={{ fontSize: 14, fontWeight: 750, color: "var(--recv)" }}>✓ Paid</div>
            : <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Waiting for payment…</div>}
          <button className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(invoice); }}>Copy invoice</button>
        </div>
      )}
    </div>
  );
}

/** Pay a BOLT11 invoice. */
function Send() {
  const { send, sendPending, sendError, sendData } = useWalletSend();
  const [bolt11, setBolt11] = useState("");
  const pay = async () => {
    const inv = bolt11.trim().replace(/^lightning:/i, "");
    if (!inv) return;
    await send({ invoice: inv });
  };
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Send</div>
      <textarea value={bolt11} onChange={(e) => setBolt11(e.target.value)} placeholder="Paste a Lightning invoice (lnbc…)" rows={3}
        style={{ ...input, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12.5 }} />
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={sendPending || !bolt11.trim()} onClick={() => { void pay(); }}>
        {sendPending ? <Spinner size={15} color="var(--accent-ink)" /> : "Pay invoice"}
      </button>
      {sendError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(sendError).slice(0, 120)}</div> : null}
      {sendData ? <div style={{ fontSize: 13, color: "var(--recv)", fontWeight: 650, marginTop: 8 }}>✓ Payment sent</div> : null}
    </div>
  );
}

/* ---- helpers ---- */
/** Spendable balance = confirmed on-chain/channel funds plus available credit line.
 *  Pending-in is surfaced separately so the headline reflects what's usable now. */
function spendableSats(b: Balance): number {
  return Math.max(0, Math.round((b.confirmedSat ?? 0) + (b.creditAvailableSat ?? 0)));
}
function statusLabel(phase: string): string {
  switch (phase) {
    case "ready": return "Wallet ready";
    case "syncing": return "Syncing…";
    case "needsWallet": return "Set up your wallet";
    case "locked": return "Wallet locked";
    case "error": return "Wallet error";
    default: return "Starting wallet…";
  }
}
function fmtSats(n: number): string { return new Intl.NumberFormat("en-US").format(n); }
