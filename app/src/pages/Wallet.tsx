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
import { useEffect, useRef, useState } from "react";
import { createWebWalletEngine, defaultConfig } from "@lightninglabs/wavelength-web";
import type { Balance } from "@lightninglabs/wavelength-core";
import {
  WavelengthProvider, useWallet, useWalletBalance, useWalletReceive,
  useWalletSend, useWalletCreate, useWalletUnlock, useWalletRestore, useWalletActivity,
} from "@lightninglabs/wavelength-react";
import { api } from "../api/client.js";
import type { Quote, Payment, ProviderId, NameSource, PaymentState } from "@shared/types.js";
import { PROVIDERS, COUNTRIES, MIN_XAF, detectProvider } from "@shared/domain.js";
import { Logo, QR, Spinner } from "../components/atoms.js";

// The wasm worker resolves each runtime asset with `new URL(name, runtimeBaseUrl)`,
// which requires an ABSOLUTE base — a root-relative path throws and importScripts
// then falls back to index.html ("Unexpected token '<'"). Resolve against the origin.
const RUNTIME_BASE =
  typeof window === "undefined"
    ? "/wavewalletdk/v0.1.1/"
    : new URL("/wavewalletdk/v0.1.1/", window.location.origin).href;

// The Bitcoin network the wallet runs against. Signet (test) is Phase 1. Going
// mainnet is gated on TWO things outside this file:
//   1. Lightning Labs publishing mainnet gateway URLs + granting mainnet access
//      (the SDK rejects a mainnet config unless allowMainnet is true — and there is
//      no public mainnet deployment to point at yet), and
//   2. the user completing a seed backup (enforced in-app before real funds).
// Flip via VITE_WALLET_NETWORK=mainnet once (1) lands and walletConfig() below is
// filled in; until then only signet is functional.
const WALLET_NETWORK: "signet" | "mainnet" =
  (import.meta.env.VITE_WALLET_NETWORK as string | undefined) === "mainnet" ? "mainnet" : "signet";
// Set true once mainnet gateway URLs exist and walletConfig()'s mainnet branch is filled.
const MAINNET_AVAILABLE = false;

/** Runtime config for the active network. `defaultConfig` only accepts preset
 *  networks (signet/testnet); mainnet must be hand-built with allowMainnet + the
 *  operator gateway URLs — plug them in here when Lightning Labs publishes them. */
function walletConfig() {
  // if (WALLET_NETWORK === "mainnet")
  //   return { network: "mainnet", allowMainnet: true, /* ...mainnet gateway URLs */ };
  return defaultConfig("signet");
}

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
      config: walletConfig(),
      autoStart: true,
    });
  }
  return _engine;
}

/** Persisted "seed has been backed up" flag. The mnemonic can ONLY be shown at
 *  creation (the SDK exposes no reveal-seed call), so this records that the user
 *  either saved a freshly-created phrase or restored from one they already hold. */
const BACKED_UP_KEY = "mm_wallet_backed_up";
function markBackedUp() { try { localStorage.setItem(BACKED_UP_KEY, "1"); } catch { /* storage blocked */ } }
function hasBackedUp(): boolean { try { return localStorage.getItem(BACKED_UP_KEY) === "1"; } catch { return false; } }

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
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: "var(--warn-ink)", background: "var(--send-wash)", border: "1px solid var(--warn)", padding: "4px 10px", borderRadius: 999 }}>⚡ {WALLET_NETWORK} · beta</span>
        </header>

        <h1 style={{ fontSize: "clamp(24px,5vw,30px)", letterSpacing: "-0.02em" }}>Lightning wallet</h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 18px", lineHeight: 1.55 }}>
          A self-custodial Lightning wallet that runs in your browser — an alternative rail alongside the settlement engine. No node or channels to manage.
        </p>

        {WALLET_NETWORK === "mainnet" && !MAINNET_AVAILABLE ? <MainnetPending /> :
          !isolated ? <IsolationHelp /> : (
          <WavelengthProvider engine={walletEngine()}>
            <WalletInner />
          </WavelengthProvider>
        )}
      </div>
    </div>
  );
}

/** Shown when the build is pointed at mainnet but mainnet isn't wired up yet
 *  (no published gateway + access pending). Keeps the flip explicit and honest. */
function MainnetPending() {
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Mainnet isn't live yet</div>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.55 }}>
        The embedded wallet runs on signet (test coins) for now. Mainnet needs Lightning Labs to publish their mainnet gateway and grant access — once that lands and the seed-backup step is complete, this page moves to real bitcoin. For now, switch back to signet to try it.
      </p>
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
  // The one-time recovery phrase to back up, captured from a fresh create(). The SDK
  // can never show it again, so while it's set we block the wallet behind BackupSeed.
  const [pendingBackup, setPendingBackup] = useState<string[] | null>(null);
  const [backedUp, setBackedUp] = useState<boolean>(hasBackedUp);

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

      {needsWallet && <CreateOrRestore onCreated={setPendingBackup} onRestored={() => { markBackedUp(); setBackedUp(true); }} />}
      {locked && <UnlockWallet />}

      {/* A freshly-created wallet MUST back up its phrase before anything else — it
          can't be shown again, and on mainnet it's the only way to recover funds. */}
      {open && pendingBackup && (
        <BackupSeed mnemonic={pendingBackup} onConfirmed={() => { markBackedUp(); setBackedUp(true); setPendingBackup(null); }} />
      )}

      {open && !pendingBackup && (
        <>
          {/* Balance */}
          <div style={{ ...card }}>
            <div className="overline">Balance</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 750, letterSpacing: "-0.02em", marginTop: 4 }}>
              {balance ? fmtSats(spendableSats(balance)) : "—"} <span style={{ fontSize: 15, color: "var(--ink-3)" }}>sats</span>
            </div>
            {balance && balance.pendingInSat > 0
              ? <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>+{fmtSats(balance.pendingInSat)} sats incoming</div>
              : null}
          </div>

          {!backedUp && <BackupWarning />}
          <MobileMoneyPayout />
          <Receive />
          <Send />
        </>
      )}
    </div>
  );
}

/** Non-blocking reminder when a wallet is open but we have no record it was ever
 *  backed up (e.g. created before this step existed, or a reload dropped the one-time
 *  phrase). Honest about the hard constraint: the phrase can't be reshown. */
function BackupWarning() {
  return (
    <div style={{ ...card, borderColor: "var(--warn)", background: "var(--send-wash)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--warn-ink)" }}>⚠ Recovery phrase not backed up</div>
      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
        The recovery phrase can only be shown when a wallet is created and can't be retrieved later. If you didn't save it, don't add real funds — create a fresh wallet and back up its phrase first.
      </p>
    </div>
  );
}

/** First run: either create a fresh wallet or restore one from a recovery phrase. */
function CreateOrRestore({ onCreated, onRestored }: { onCreated: (mnemonic: string[]) => void; onRestored: () => void }) {
  const [mode, setMode] = useState<"create" | "restore">("create");
  return (
    <div style={{ ...card }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, background: "var(--surface-2)", borderRadius: "var(--r)", padding: 4 }}>
        {(["create", "restore"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            style={{ flex: 1, padding: "8px 0", borderRadius: "calc(var(--r) - 3px)", border: "none", background: mode === m ? "var(--surface)" : "transparent", boxShadow: mode === m ? "var(--shadow-sm)" : "none", color: mode === m ? "var(--ink)" : "var(--ink-3)", fontWeight: 650, fontSize: 13.5, cursor: "pointer" }}>
            {m === "create" ? "Create" : "Restore"}
          </button>
        ))}
      </div>
      {mode === "create" ? <CreateForm onCreated={onCreated} /> : <RestoreForm onRestored={onRestored} />}
    </div>
  );
}

/** Create a fresh self-custodial wallet, encrypted with a password that never leaves
 *  the device. On success the SDK returns the recovery phrase ONCE — handed straight
 *  to the mandatory backup step. */
function CreateForm({ onCreated }: { onCreated: (mnemonic: string[]) => void }) {
  const { create, createPending, createError } = useWalletCreate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw2.length > 0 && pw !== pw2;
  const canCreate = pw.length >= 8 && pw === pw2 && !createPending;
  const submit = async () => {
    const res = await create({ password: pw });
    if (res?.mnemonic?.length) onCreated(res.mnemonic);
  };
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Create your wallet</div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>A new self-custodial wallet on {WALLET_NETWORK}. Your keys stay on this device — the password encrypts them and is never sent anywhere. You'll back up a recovery phrase next.</p>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password (min 8 characters)" autoComplete="new-password" style={input} />
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm password" autoComplete="new-password" style={input} />
      </div>
      {mismatch ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>Passwords don't match.</div> : null}
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!canCreate} onClick={() => { void submit(); }}>
        {createPending ? <Spinner size={15} color="var(--accent-ink)" /> : "Create wallet"}
      </button>
      {createError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(createError.message ?? createError).slice(0, 120)}</div> : null}
    </div>
  );
}

/** Restore an existing wallet on a new device from its recovery phrase. `recoverState`
 *  makes the daemon rebuild balances/history from the seed via the operator indexer. */
function RestoreForm({ onRestored }: { onRestored: () => void }) {
  const { restore, restorePending, restoreError } = useWalletRestore();
  const [phrase, setPhrase] = useState("");
  const [pw, setPw] = useState("");
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const validLen = words.length === 12 || words.length === 24;
  const canRestore = validLen && pw.length >= 8 && !restorePending;
  const submit = async () => {
    await restore({ mnemonic: words, password: pw, recoverState: true });
    onRestored();
  };
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Restore your wallet</div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>Enter your 12- or 24-word recovery phrase and set a password to encrypt it on this device.</p>
      <textarea value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Recovery phrase (words separated by spaces)" rows={3}
        autoComplete="off" autoCapitalize="none" spellCheck={false}
        style={{ ...input, marginTop: 12, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 13.5 }} />
      {phrase.trim() && !validLen ? <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>{words.length} words — a phrase is 12 or 24 words.</div> : null}
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8 characters)" autoComplete="new-password" style={{ ...input, marginTop: 8 }} />
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!canRestore} onClick={() => { void submit(); }}>
        {restorePending ? <Spinner size={15} color="var(--accent-ink)" /> : "Restore wallet"}
      </button>
      {restoreError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(restoreError.message ?? restoreError).slice(0, 120)}</div> : null}
    </div>
  );
}

/** Mandatory seed backup, shown once right after creation. Displays the recovery
 *  phrase, then verifies the user actually saved it (re-enter two random words)
 *  before the wallet can be used — the phrase can never be shown again. */
function BackupSeed({ mnemonic, onConfirmed }: { mnemonic: string[]; onConfirmed: () => void }) {
  const [step, setStep] = useState<"show" | "verify">("show");
  // Two distinct 1-based positions to quiz — derived from the phrase so no RNG.
  const q1 = (mnemonic.length >> 1) % mnemonic.length;
  const q2 = (q1 + 7) % mnemonic.length;
  const [a1, setA1] = useState("");
  const [a2, setA2] = useState("");
  const ok = a1.trim().toLowerCase() === mnemonic[q1] && a2.trim().toLowerCase() === mnemonic[q2];

  if (step === "show") {
    return (
      <div style={{ ...card, borderColor: "var(--warn)" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Back up your recovery phrase</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
          Write these {mnemonic.length} words down in order and keep them offline. They're the <b>only</b> way to recover this wallet — we can't show them again and can't reset them.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, margin: "12px 0" }}>
          {mnemonic.map((w, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "7px 10px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r)" }}>
              <span className="num" style={{ fontSize: 10.5, color: "var(--ink-3)", width: 16, textAlign: "right" }}>{i + 1}</span>
              <span className="num" style={{ fontSize: 13.5, fontWeight: 650 }}>{w}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => setStep("verify")}>I've written them down</button>
      </div>
    );
  }
  return (
    <div style={{ ...card, borderColor: "var(--warn)" }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Confirm your backup</div>
      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>Enter the words at these positions to confirm you saved the phrase.</p>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <label style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Word #{q1 + 1}
          <input value={a1} onChange={(e) => setA1(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} style={{ ...input, marginTop: 4, fontFamily: "var(--font-mono)" }} /></label>
        <label style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Word #{q2 + 1}
          <input value={a2} onChange={(e) => setA2(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} style={{ ...input, marginTop: 4, fontFamily: "var(--font-mono)" }} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-ghost" style={{ flex: "0 0 auto" }} onClick={() => setStep("show")}>Show phrase</button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={!ok} onClick={onConfirmed}>Confirm &amp; open wallet</button>
      </div>
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

/* ============================================================
   Send to Mobile Money — the multi-rail bridge. The embedded wallet pays the
   PLATFORM's Lightning invoice; settlement + the XAF payout then run server-side
   over the trusted IBEX→Peexit rail (the wallet is only the payer, never the
   settlement rail — see the money-flow rationale in memory/wavelength-wallet.md).
   Phase 1 is signet, so this can only settle for real once BOTH the wallet and the
   platform's IBEX rail are on mainnet; until then it exercises quote→invoice→pay.
   ============================================================ */
const FAIL_STATES: PaymentState[] = ["FAILED", "MANUAL_REVIEW", "REFUND_PENDING", "REFUNDED"];
const POLL_CAP_MS = 4 * 60_000;

function MobileMoneyPayout() {
  const balance = useWalletBalance();
  const { send } = useWalletSend();
  const [phone, setPhone] = useState("");
  const [xaf, setXaf] = useState("");
  const [provider, setProvider] = useState<ProviderId>("MTN");
  const [name, setName] = useState("");
  const [nameSource, setNameSource] = useState<NameSource>("idle");
  const [resolving, setResolving] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mounted = useRef(true);
  // Set true on every mount (not just once) so StrictMode's mount→unmount→remount
  // cycle can't leave the ref stuck false and freeze `busy` on after an async call.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const digits = phone.replace(/\D/g, "");
  const amt = Number(xaf.replace(/\D/g, "")) || 0;
  const spendable = balance ? Math.max(0, (balance.confirmedSat ?? 0) + (balance.creditAvailableSat ?? 0)) : 0;
  const needSats = quote ? Math.round(quote.inboundAmount * 1e8) : 0;

  // Resolve the recipient (operator + registered name) once the number is complete —
  // same anonymous lookup the main send flow uses (CM only: the live Peexit corridor).
  useEffect(() => {
    let active = true;
    if (digits.length < 8) { setName(""); setNameSource("idle"); return; }
    const detected = detectProvider(digits, "CM");
    if (detected) setProvider(detected);
    setResolving(true);
    const h = setTimeout(async () => {
      try {
        const r = await api.resolveRecipient(digits, "CM");
        if (!active) return;
        if (r.provider && COUNTRIES.CM.providers.includes(r.provider)) setProvider(r.provider);
        setName(r.name ?? ""); setNameSource(r.status);
      } catch { /* leave name for manual entry */ }
      finally { if (active) setResolving(false); }
    }, 450);
    return () => { active = false; clearTimeout(h); };
  }, [digits]);

  const canQuote = amt >= MIN_XAF && digits.length >= 8 && name.trim().length >= 2 && !resolving && !busy;

  const getQuote = async () => {
    setErr(null); setBusy(true);
    try { setQuote(await api.createQuote({ xaf: amt, method: "LIGHTNING", country: "CM" })); }
    catch (e) { setErr(errMsg(e)); }
    finally { if (mounted.current) setBusy(false); }
  };

  const pollDelivery = (id: string) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const p = await api.getPayment(id);
        if (!mounted.current) return;
        setPayment(p);
        if (p.state === "DELIVERED" || FAIL_STATES.includes(p.state)) { setBusy(false); return; }
      } catch { /* transient — keep polling */ }
      if (!mounted.current) return;
      if (Date.now() - started > POLL_CAP_MS) { setBusy(false); return; }
      setTimeout(tick, 2500);
    };
    void tick();
  };

  const payFromWallet = async () => {
    if (!quote) return;
    setErr(null); setBusy(true);
    let created: Payment | null = null;
    try {
      created = await api.createPayment({ quoteId: quote.id, recipient: { phone: digits, country: "CM", provider, name: name.trim(), nameSource } });
      if (mounted.current) setPayment(created);
      // Pay the platform's Lightning invoice from the embedded wallet. Once it settles
      // at IBEX, the server auto-fires the Peexit payout — we just poll for delivery.
      await send({ invoice: created.payInstruction.code });
      pollDelivery(created.id);
    } catch (e) {
      if (!mounted.current) return;
      setErr(errMsg(e));
      setBusy(false);
      // createPayment succeeded but the wallet couldn't pay → keep the payment so the
      // user can retry the pay step; if createPayment itself failed, drop back to quote.
      if (!created) setPayment(null);
    }
  };

  const reset = () => { setQuote(null); setPayment(null); setErr(null); setBusy(false); };

  // ---- Result / in-flight ----
  if (payment) {
    const delivered = payment.state === "DELIVERED";
    const failed = FAIL_STATES.includes(payment.state);
    const rec = payment.recipient;
    return (
      <div style={{ ...card }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Send to Mobile Money</div>
        <div style={{ display: "grid", placeItems: "center", gap: 8, padding: "8px 0" }}>
          {delivered
            ? <div style={{ fontSize: 30 }}>✅</div>
            : failed ? <div style={{ fontSize: 30 }}>⚠️</div>
            : <Spinner size={26} color="var(--accent)" />}
          <div style={{ fontSize: 15, fontWeight: 750, textAlign: "center" }}>
            {delivered ? "Delivered" : failed ? "Couldn't deliver" : err ? "Payment not sent" : "Settling…"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", textAlign: "center" }}>
            {fmtXaf(payment.xaf)} XAF → {rec.name || rec.phone} · {PROVIDERS[rec.provider]?.short ?? rec.provider} {COUNTRIES[rec.country]?.dial} {rec.phone}
          </div>
          <div className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{payment.ref} · {payment.state.toLowerCase().replace(/_/g, " ")}</div>
        </div>
        {err ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 4, textAlign: "center" }}>{err}</div> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {err && !delivered && !failed && (
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => { void payFromWallet(); }}>
              {busy ? <Spinner size={14} color="var(--accent-ink)" /> : "Try payment again"}
            </button>
          )}
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={reset}>{delivered || failed ? "Done" : "Close"}</button>
        </div>
      </div>
    );
  }

  // ---- Quote review ----
  if (quote) {
    const short = spendable < needSats;
    return (
      <div style={{ ...card }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Confirm transfer</div>
        <Row k="Recipient" v={`${name || digits} · ${PROVIDERS[provider]?.short ?? provider}`} />
        <Row k="They receive" v={`${fmtXaf(quote.xaf)} XAF`} strong />
        <Row k="You pay" v={`${fmtSats(needSats)} sats`} />
        <Row k="Fee" v={`${fmtXaf(quote.feeXaf)} XAF`} />
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "10px 0 0", lineHeight: 1.5 }}>
          Paid from your wallet over Lightning; delivery to Mobile Money settles on the platform rail (IBEX → Peexit). Signet beta — real delivery needs the wallet and platform on the same network.
        </div>
        {short ? <div style={{ fontSize: 12.5, color: "var(--warn-ink)", marginTop: 8 }}>Wallet balance is {fmtSats(spendable)} sats — not enough to cover this transfer.</div> : null}
        {err ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{err}</div> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-ghost" style={{ flex: "0 0 auto" }} onClick={reset} disabled={busy}>Back</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || short} onClick={() => { void payFromWallet(); }}>
            {busy ? <Spinner size={15} color="var(--accent-ink)" /> : "Pay from wallet"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Form ----
  const verified = nameSource === "provider" || nameSource === "internal";
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Send to Mobile Money</div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 12px", lineHeight: 1.5 }}>Pay an MTN or Orange Money number in Cameroon straight from this wallet.</p>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "0 11px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--ink-2)" }}>{COUNTRIES.CM.dial}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="6 XX XX XX XX" style={{ ...input, flex: 1, fontFamily: "var(--font-mono)" }} />
        </div>
        {digits.length >= 8 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--ink-2)" }}>
            {resolving ? <><Spinner size={12} color="var(--accent)" /> Checking…</>
              : verified ? <span style={{ color: "var(--recv)" }}>✓ {name} · {PROVIDERS[provider]?.name}</span>
              : <input value={name} onChange={(e) => { setName(e.target.value); setNameSource("manual"); }} placeholder="Recipient name" style={{ ...input, padding: "8px 11px", fontSize: 13 }} />}
          </div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          {COUNTRIES.CM.providers.map((pid) => (
            <button key={pid} type="button" onClick={() => setProvider(pid)}
              style={{ flex: 1, padding: "9px 0", borderRadius: "var(--r)", border: `1px solid ${provider === pid ? "var(--accent)" : "var(--line)"}`, background: provider === pid ? "var(--send-wash)" : "var(--surface-2)", color: "var(--ink)", fontWeight: 650, fontSize: 13, cursor: "pointer" }}>
              {PROVIDERS[pid].name}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <input value={xaf ? fmtXaf(amt) : ""} onChange={(e) => setXaf(e.target.value)} inputMode="numeric" placeholder="Amount" style={{ ...input, flex: 1, fontFamily: "var(--font-mono)" }} />
          <span style={{ display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>XAF</span>
        </div>
        {amt > 0 && amt < MIN_XAF ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Minimum {fmtXaf(MIN_XAF)} XAF.</div> : null}
      </div>
      {err ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{err}</div> : null}
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!canQuote} onClick={() => { void getQuote(); }}>
        {busy ? <Spinner size={15} color="var(--accent-ink)" /> : "Get quote"}
      </button>
    </div>
  );
}

/** A compact key/value row for the quote review. */
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{k}</span>
      <span className="num" style={{ fontSize: strong ? 16 : 13.5, fontWeight: strong ? 750 : 600, color: "var(--ink)" }}>{v}</span>
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
function fmtXaf(n: number): string { return new Intl.NumberFormat("fr-FR").format(Math.round(n)); }
function errMsg(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/^Error:\s*/, "").slice(0, 160);
}
