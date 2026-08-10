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
import type { Balance, RuntimeConfig, Entry } from "@lightninglabs/wavelength-core";
import {
  WavelengthProvider, useWallet, useWalletBalance, useWalletReceive,
  useWalletSend, useWalletCreate, useWalletUnlock, useWalletRestore, useWalletActivity,
} from "@lightninglabs/wavelength-react";
import { api } from "../api/client.js";
import { useI18n } from "../lib/i18n.js";
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

// Mainnet endpoints. `defaultConfig` has no mainnet preset, so mainnet is hand-built
// from the operator gateway URLs Lightning Labs publishes (Ark server + Esplora, and
// optionally the Lightning-swap server). They're env-driven so going mainnet is a
// pure config flip — no code change: set VITE_WALLET_NETWORK=mainnet plus these.
const MAINNET_ARK = import.meta.env.VITE_WALLET_MAINNET_ARK_URL as string | undefined;
const MAINNET_ESPLORA = import.meta.env.VITE_WALLET_MAINNET_ESPLORA_URL as string | undefined;
const MAINNET_SWAP = import.meta.env.VITE_WALLET_MAINNET_SWAP_URL as string | undefined;
// Mainnet is usable only once the required endpoints are supplied.
const MAINNET_AVAILABLE = !!(MAINNET_ARK && MAINNET_ESPLORA);

/** Runtime config for the active network. `defaultConfig` only accepts preset
 *  networks (signet/testnet); mainnet is assembled from the env-supplied operator
 *  endpoints + allowMainnet (the SDK rejects a mainnet config without it). */
function walletConfig(): RuntimeConfig {
  if (WALLET_NETWORK === "mainnet") {
    return {
      network: "mainnet",
      allowMainnet: true,
      arkServerAddress: MAINNET_ARK,
      walletEsploraUrl: MAINNET_ESPLORA,
      ...(MAINNET_SWAP ? { swapServerAddress: MAINNET_SWAP } : { disableSwaps: true }),
    };
  }
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

// One-shot per-session guard for the auto-reload that self-heals a transient cold-load
// worker error (see WalletInner). sessionStorage so it resets on a new tab/session.
const AUTO_RELOAD_KEY = "mm_wallet_autoreload";

/** A LOCKED / corrupt wallet-database error — recoverable by resetting the on-device
 *  wallet. The wasm daemon stores its wallet as an OPFS SQLite DB; a stale lock (another
 *  tab, or a session that didn't close cleanly) makes "probe wallet database: open" fail.
 *  A plain reload usually can't clear it, so we surface a Reset action. */
function isLockError(error: Error | null): boolean {
  const m = String(error?.message ?? error ?? "").toLowerCase();
  return ["probe wallet database", "wallet database", "create lwwallet", "locked", "opfs", "sqlite", "access handle", "readiness"].some((s) => m.includes(s));
}

/** Erase the wallet stored on THIS device (OPFS SQLite DB + IndexedDB + our flags),
 *  then reload. DESTRUCTIVE and USER-INITIATED ONLY — funds are recoverable only via the
 *  seed phrase. Keeps the cached wasm runtime (that lives in Cache Storage, not OPFS),
 *  so recovery doesn't re-download it. Recovers from a locked/corrupt wallet database. */
async function resetLocalWallet(): Promise<void> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    // FileSystemDirectoryHandle is async-iterable; remove every top-level entry.
    if (root) {
      const names: string[] = [];
      for await (const [name] of (root as unknown as AsyncIterable<[string, unknown]>)) names.push(name);
      for (const name of names) { try { await root.removeEntry(name, { recursive: true }); } catch { /* ignore */ } }
    }
  } catch { /* OPFS unavailable */ }
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(dbs.map((d) => d?.name
      ? new Promise<void>((res) => { const r = indexedDB.deleteDatabase(d.name!); r.onsuccess = r.onerror = r.onblocked = () => res(); })
      : Promise.resolve()));
  } catch { /* ignore */ }
  try { localStorage.removeItem(BACKED_UP_KEY); sessionStorage.removeItem(AUTO_RELOAD_KEY); } catch { /* ignore */ }
  window.location.assign("/wallet");
}

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-sm)", padding: 18 };
const input: React.CSSProperties = { width: "100%", padding: "12px 13px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", font: "inherit", fontSize: 15, color: "var(--ink)", outline: "none" };

/* ---- shared small UI ---- */
const EyeIcon = ({ off }: { off: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {off
      ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
      : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>
);

/** Password field with a show/hide toggle — standard for a wallet password that's
 *  typed carefully and only once. Icon-only toggle keeps it compact; aria-labels
 *  are localized so the whole flow stays FR/EN. */
function PasswordInput({ value, onChange, placeholder, autoComplete, onEnter }: {
  value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string; onEnter?: () => void;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} aria-label={placeholder} autoComplete={autoComplete}
        onKeyDown={onEnter ? (e) => { if (e.key === "Enter") onEnter(); } : undefined}
        style={{ ...input, paddingRight: 42 }} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={t(show ? "wallet_hide_pw" : "wallet_show_pw")} aria-pressed={show}
        style={{ position: "absolute", right: 4, top: 0, bottom: 0, width: 38, display: "grid", placeItems: "center", background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", padding: 0 }}>
        <EyeIcon off={show} />
      </button>
    </div>
  );
}

export function Wallet() {
  const { t } = useI18n();
  const isolated = typeof window === "undefined" || window.crossOriginIsolated;
  return (
    <div className="app-bg" style={{ background: "var(--paper)", minHeight: "100dvh" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "12px clamp(16px,4vw,24px) 48px" }}>
        {/* Full-nav header (plain <a>) so this stays an isolated island. */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0 16px" }}>
          <a href="/" aria-label="MoMo›Me — home" style={{ textDecoration: "none", display: "inline-flex" }}><Logo size={30} /></a>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: "var(--warn-ink)", background: "var(--send-wash)", border: "1px solid var(--warn)", padding: "4px 10px", borderRadius: 999 }}>⚡ {WALLET_NETWORK} · {t("wallet_beta")}</span>
        </header>

        <h1 style={{ fontSize: "clamp(24px,5vw,30px)", letterSpacing: "-0.02em" }}>{t("wallet_title")}</h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, margin: "6px 0 18px", lineHeight: 1.55 }}>
          {t("wallet_intro")}
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
  const { t } = useI18n();
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_mainnet_title")}</div>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.55 }}>
        {t("wallet_mainnet_body")}
      </p>
    </div>
  );
}

/** Shown if the page wasn't loaded cross-origin-isolated (e.g. reached via a client-side
 *  link instead of a fresh load). A hard reload picks up the COOP/COEP headers. */
function IsolationHelp() {
  const { t } = useI18n();
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_isolation_title")}</div>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.55 }}>
        {t("wallet_isolation_body")}
      </p>
      <a href="/wallet" className="btn btn-primary" style={{ marginTop: 14, textDecoration: "none", display: "inline-flex" }}>{t("wallet_reload")}</a>
    </div>
  );
}

function WalletInner() {
  const { t } = useI18n();
  const { phase, error } = useWallet();
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
  const errored = phase === "error";
  const booting = !open && !needsWallet && !locked && !errored;

  // Self-heal the transient first-load "Wavelength worker error": the wasm worker
  // occasionally fails to start on a COLD load (asset warm-up race) and a reload
  // fixes it (assets are then cached). Do that reload automatically ONCE per session
  // so a self-healing hiccup never shows a scary error card — but never loop (a
  // second failure shows ErrorCard), and never while a one-time recovery phrase is on
  // screen (a reload would lose it). The guard is cleared once the wallet is healthy.
  // `recovering` is component state (not a render-time storage read) so a browser with
  // sessionStorage blocked still falls through to the ErrorCard instead of spinning
  // forever on the neutral booting card.
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    if (!errored || pendingBackup) return;
    try {
      if (sessionStorage.getItem(AUTO_RELOAD_KEY) === "1") return; // already retried this session
      sessionStorage.setItem(AUTO_RELOAD_KEY, "1");
      setRecovering(true);
      window.location.reload();
    } catch { /* sessionStorage blocked → fall through to the error card */ }
  }, [errored, pendingBackup]);
  useEffect(() => {
    if (open || needsWallet || locked) { try { sessionStorage.removeItem(AUTO_RELOAD_KEY); } catch { /* ignore */ } }
  }, [open, needsWallet, locked]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {errored && (recovering ? <BootingCard phase="starting" /> : <ErrorCard error={error} />)}
      {booting && <BootingCard phase={phase} />}

      {needsWallet && <CreateOrRestore onCreated={setPendingBackup} onRestored={() => { markBackedUp(); setBackedUp(true); }} />}
      {locked && <UnlockWallet />}

      {/* A freshly-created wallet MUST back up its phrase before anything else — it
          can't be shown again, and on mainnet it's the only way to recover funds. */}
      {open && pendingBackup && (
        <BackupSeed mnemonic={pendingBackup} onConfirmed={() => { markBackedUp(); setBackedUp(true); setPendingBackup(null); }} />
      )}

      {open && !pendingBackup && <WalletHome phase={phase} backedUp={backedUp} />}
    </div>
  );
}

type WalletView = "home" | "receive" | "send" | "momo";

/** Minimal, one-task-at-a-time home: a balance hero + three action tiles. Picking an
 *  action swaps to just that flow (with a Back) instead of stacking every form on one
 *  screen — so the wallet reads as a clean home, not a wall of cards. A light pop-in
 *  keeps view changes smooth. */
function WalletHome({ phase, backedUp }: { phase: string; backedUp: boolean }) {
  const { t } = useI18n();
  const [view, setView] = useState<WalletView>("home");
  const balance = useWalletBalance();
  const sats = balance ? spendableSats(balance) : null;

  if (view !== "home") {
    return (
      <div style={{ display: "grid", gap: 14, animation: "pop .18s ease" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setView("home")} style={{ justifySelf: "start" }}>← {t("wallet_back")}</button>
        {view === "receive" && <Receive />}
        {view === "send" && <Send />}
        {view === "momo" && <MobileMoneyPayout onDone={() => setView("home")} />}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, animation: "pop .18s ease" }}>
      {/* Balance hero with an inline ready/syncing chip. */}
      <div style={{ ...card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="overline">{t("wallet_balance")}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: phase === "syncing" ? "var(--warn)" : "var(--recv)", flex: "none" }} />
            {phase === "syncing" ? t("wallet_syncing_short") : t("wallet_ready_short")}
          </span>
        </div>
        <div className="num" style={{ fontSize: 34, fontWeight: 750, letterSpacing: "-0.02em", marginTop: 6 }}>
          {sats != null ? fmtSats(sats) : "—"} <span style={{ fontSize: 15, color: "var(--ink-3)" }}>sats</span>
        </div>
        {balance && balance.pendingInSat > 0
          ? <div style={{ fontSize: 12.5, color: "var(--recv)", marginTop: 4 }}>+{fmtSats(balance.pendingInSat)} {t("wallet_sats_incoming")}</div>
          : null}
      </div>

      {!backedUp && <BackupWarning />}

      {/* Action tiles — one tap into a focused flow. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <ActionTile label={t("wallet_receive")} glyph="↓" onClick={() => setView("receive")} />
        <ActionTile label={t("wallet_send")} glyph="↑" onClick={() => setView("send")} />
        <ActionTile label={t("wallet_pay_momo")} glyph="⚡" onClick={() => setView("momo")} />
      </div>

      <Activity />
    </div>
  );
}

/** A single tappable action on the wallet home. */
function ActionTile({ label, glyph, onClick }: { label: string; glyph: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: "grid", gap: 8, placeItems: "center", padding: "15px 6px", borderRadius: "var(--r-lg)", border: "1px solid var(--line)", background: "var(--surface)", boxShadow: "var(--shadow-sm)", cursor: "pointer", color: "var(--ink)", transition: "transform .1s ease, border-color .15s ease" }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "none"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}>
      <span style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--send-wash)", color: "var(--accent)", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 800 }}>{glyph}</span>
      <span style={{ fontSize: 12.5, fontWeight: 650 }}>{label}</span>
    </button>
  );
}

/** The wasm runtime is booting (first load streams ~130 MB, so this can take a
 *  moment). A warm, honest loading state beats a bare spinner. */
function BootingCard({ phase }: { phase: string }) {
  const { t } = useI18n();
  return (
    <div style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
      <Spinner size={18} color="var(--accent)" />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{statusLabel(phase, t)}</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{t("wallet_booting_hint")}</div>
      </div>
    </div>
  );
}

/** The runtime hit a terminal error (e.g. a stuck storage lock). Offer the fix that
 *  actually works — a full reload — instead of stranding the user on a dead screen. */
function ErrorCard({ error }: { error: Error | null }) {
  const { t } = useI18n();
  const [resetting, setResetting] = useState(false);
  const locked = isLockError(error);
  const doReset = () => {
    if (!window.confirm(t("wallet_reset_confirm"))) return; // explicit consent — destructive
    setResetting(true);
    void resetLocalWallet();
  };
  return (
    <div style={{ ...card, borderColor: "var(--bad)" }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_error_title")}</div>
      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
        {locked
          ? t("wallet_error_locked_body")
          : `${error ? String(error.message ?? error).slice(0, 140) : t("wallet_error_stopped")}${t("wallet_error_reload_hint")}`}
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <a href="/wallet" className="btn btn-primary" style={{ textDecoration: "none", display: "inline-flex" }}>{t("wallet_reload")}</a>
        {locked && (
          <button className="btn btn-ghost" style={{ borderColor: "var(--bad)", color: "var(--bad)" }} disabled={resetting} onClick={doReset}>
            {resetting ? t("wallet_resetting") : t("wallet_reset")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Recent wallet activity (newest first) from the daemon's event log. */
const KIND_GLYPH: Record<string, string> = { send: "↑", receive: "↓", deposit: "↓", exit: "⇄" };
function Activity() {
  const { t } = useI18n();
  const items = useWalletActivity().slice(0, 8);
  if (!items.length) return null;
  return (
    <div style={{ ...card }}>
      <div className="overline" style={{ marginBottom: 8 }}>{t("wallet_activity")}</div>
      <div style={{ display: "grid" }}>
        {items.map((e) => <ActivityRow key={e.id} e={e} />)}
      </div>
    </div>
  );
}
function ActivityRow({ e }: { e: Entry }) {
  const incoming = e.kind === "receive" || e.kind === "deposit";
  const amtColor = e.status === "failed" ? "var(--bad)" : incoming ? "var(--recv)" : "var(--ink)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface-2)", display: "grid", placeItems: "center", fontSize: 13, flex: "none" }}>{KIND_GLYPH[e.kind] ?? "•"}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.kind}{e.note ? ` · ${e.note}` : ""}</div>
        <div style={{ fontSize: 11, color: e.status === "failed" ? "var(--bad)" : "var(--ink-3)" }}>{e.status}{e.status === "failed" && e.failureReason ? ` · ${e.failureReason.slice(0, 36)}` : ""}</div>
      </div>
      <div className="num" style={{ fontSize: 13, fontWeight: 650, color: amtColor, flex: "none" }}>{incoming ? "+" : "−"}{fmtSats(e.amountSat)}</div>
    </div>
  );
}

/** Non-blocking reminder when a wallet is open but we have no record it was ever
 *  backed up (e.g. created before this step existed, or a reload dropped the one-time
 *  phrase). Honest about the hard constraint: the phrase can't be reshown. */
function BackupWarning() {
  const { t } = useI18n();
  return (
    <div style={{ ...card, borderColor: "var(--warn)", background: "var(--send-wash)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--warn-ink)" }}>{t("wallet_backup_warn_title")}</div>
      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
        {t("wallet_backup_warn_body")}
      </p>
    </div>
  );
}

/** First run: either create a fresh wallet or restore one from a recovery phrase. */
function CreateOrRestore({ onCreated, onRestored }: { onCreated: (mnemonic: string[]) => void; onRestored: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"create" | "restore">("create");
  return (
    <div style={{ ...card }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, background: "var(--surface-2)", borderRadius: "var(--r)", padding: 4 }}>
        {(["create", "restore"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            style={{ flex: 1, padding: "8px 0", borderRadius: "calc(var(--r) - 3px)", border: "none", background: mode === m ? "var(--surface)" : "transparent", boxShadow: mode === m ? "var(--shadow-sm)" : "none", color: mode === m ? "var(--ink)" : "var(--ink-3)", fontWeight: 650, fontSize: 13.5, cursor: "pointer" }}>
            {m === "create" ? t("wallet_tab_create") : t("wallet_tab_restore")}
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
  const { t } = useI18n();
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
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_create_title")}</div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>{t("wallet_create_body_a")}{WALLET_NETWORK}{t("wallet_create_body_b")}</p>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <PasswordInput value={pw} onChange={setPw} placeholder={t("wallet_pw_ph")} autoComplete="new-password" />
        <PasswordInput value={pw2} onChange={setPw2} placeholder={t("wallet_pw_confirm_ph")} autoComplete="new-password" onEnter={() => { if (canCreate) void submit(); }} />
      </div>
      {mismatch ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{t("wallet_pw_mismatch")}</div> : null}
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!canCreate} onClick={() => { void submit(); }}>
        {createPending ? <Spinner size={15} color="var(--accent-ink)" /> : t("wallet_create_btn")}
      </button>
      {createError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(createError.message ?? createError).slice(0, 120)}</div> : null}
    </div>
  );
}

/** Restore an existing wallet on a new device from its recovery phrase. `recoverState`
 *  makes the daemon rebuild balances/history from the seed via the operator indexer. */
function RestoreForm({ onRestored }: { onRestored: () => void }) {
  const { t } = useI18n();
  const { restore, restorePending, restoreError } = useWalletRestore();
  const [phrase, setPhrase] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const validLen = words.length === 12 || words.length === 24;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const canRestore = validLen && pw.length >= 8 && pw === pw2 && !restorePending;
  const submit = async () => {
    await restore({ mnemonic: words, password: pw, recoverState: true });
    onRestored();
  };
  const pastePhrase = async () => { try { const txt = await navigator.clipboard?.readText(); if (txt) setPhrase(txt.trim().replace(/\s+/g, " ")); } catch { /* clipboard blocked */ } };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_restore_title")}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void pastePhrase(); }}>{t("wallet_paste")}</button>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>{t("wallet_restore_body")}</p>
      <textarea value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={t("wallet_phrase_ph")} rows={3}
        autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label={t("wallet_phrase_ph")}
        style={{ ...input, marginTop: 12, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 13.5 }} />
      {phrase.trim() && !validLen ? <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>{words.length} {t("wallet_words_hint")}</div> : null}
      <div style={{ marginTop: 8 }}>
        <PasswordInput value={pw} onChange={setPw} placeholder={t("wallet_pw_new_ph")} autoComplete="new-password" onEnter={() => { if (canRestore) void submit(); }} />
      </div>
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={t("wallet_pw_confirm_ph")} autoComplete="new-password" style={{ ...input, marginTop: 8 }} />
      {mismatch ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{t("wallet_pw_mismatch")}</div> : null}
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!canRestore} onClick={() => { void submit(); }}>
        {restorePending ? <Spinner size={15} color="var(--accent-ink)" /> : t("wallet_restore_btn")}
      </button>
      {restoreError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(restoreError.message ?? restoreError).slice(0, 120)}</div> : null}
    </div>
  );
}

/** Mandatory seed backup, shown once right after creation. Displays the recovery
 *  phrase, then verifies the user actually saved it (re-enter two random words)
 *  before the wallet can be used — the phrase can never be shown again. */
function BackupSeed({ mnemonic, onConfirmed }: { mnemonic: string[]; onConfirmed: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<"show" | "verify">("show");
  // Two DISTINCT positions to quiz, chosen with crypto RNG once at mount — so a user
  // can't "pass" the check by memorising fixed slots instead of the whole phrase.
  const [quiz] = useState<[number, number]>(() => {
    const n = mnemonic.length;
    const buf = new Uint32Array(2);
    try { crypto.getRandomValues(buf); } catch { buf[0] = n >> 1; buf[1] = (n >> 1) + 7; }
    let a = buf[0] % n; let b = buf[1] % n;
    if (b === a) b = (a + 1) % n; // ensure distinct
    return [a, b];
  });
  const [q1, q2] = quiz;
  const [a1, setA1] = useState("");
  const [a2, setA2] = useState("");
  const ok = a1.trim().toLowerCase() === mnemonic[q1] && a2.trim().toLowerCase() === mnemonic[q2];

  if (step === "show") {
    return (
      <div style={{ ...card, borderColor: "var(--warn)" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_backup_title")}</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
          {t("wallet_backup_write_pre")} {mnemonic.length} {t("wallet_backup_write_post")}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, margin: "12px 0" }}>
          {mnemonic.map((w, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "7px 10px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r)" }}>
              <span className="num" style={{ fontSize: 10.5, color: "var(--ink-3)", width: 16, textAlign: "right" }}>{i + 1}</span>
              <span className="num" style={{ fontSize: 13.5, fontWeight: 650 }}>{w}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => setStep("verify")}>{t("wallet_backup_written_btn")}</button>
      </div>
    );
  }
  return (
    <div style={{ ...card, borderColor: "var(--warn)" }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_backup_confirm_title")}</div>
      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>{t("wallet_backup_confirm_body")}</p>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <label style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{t("wallet_word")} #{q1 + 1}
          <input value={a1} onChange={(e) => setA1(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} style={{ ...input, marginTop: 4, fontFamily: "var(--font-mono)" }} /></label>
        <label style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{t("wallet_word")} #{q2 + 1}
          <input value={a2} onChange={(e) => setA2(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} style={{ ...input, marginTop: 4, fontFamily: "var(--font-mono)" }} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-ghost" style={{ flex: "0 0 auto" }} onClick={() => setStep("show")}>{t("wallet_show_phrase")}</button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={!ok} onClick={onConfirmed}>{t("wallet_confirm_open")}</button>
      </div>
    </div>
  );
}

/** A wallet already exists on this device — unlock it with its password. */
function UnlockWallet() {
  const { t } = useI18n();
  const { unlock, unlockPending, unlockError } = useWalletUnlock();
  const [pw, setPw] = useState("");
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_unlock_title")}</div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>{t("wallet_unlock_body")}</p>
      <div style={{ marginTop: 12 }}>
        <PasswordInput value={pw} onChange={setPw} placeholder={t("wallet_password_ph")} autoComplete="current-password" onEnter={() => { if (pw && !unlockPending) void unlock({ password: pw }); }} />
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!pw || unlockPending} onClick={() => { void unlock({ password: pw }); }}>
        {unlockPending ? <Spinner size={15} color="var(--accent-ink)" /> : t("wallet_unlock_btn")}
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

function MobileMoneyPayout({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
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

  // Tick every second while a quote is on screen so the expiry countdown updates and
  // the Pay button disables the moment the locked rate lapses (the quote is only firm
  // until expiresAt; paying a stale quote would 409 at createPayment and dead-end).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!quote || payment) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [quote, payment]);

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

  // Retry the PAY step for the EXISTING payment — never mint a new payment/invoice.
  // On a flaky link send() can settle server-side while its promise rejects; a naive
  // retry that re-created the payment would pay a second invoice (double-pay + double
  // payout). So first re-check: if the payment already left AWAITING_INBOUND the
  // inbound landed — just resume polling. Otherwise re-pay the SAME BOLT11 (single-use,
  // so it can't settle twice). Mirrors the main send flow's repay() guard.
  const retryPay = async () => {
    const p = payment;
    if (!p) return;
    setErr(null); setBusy(true);
    try {
      const cur = await api.getPayment(p.id).catch(() => p);
      if (mounted.current) setPayment(cur);
      if (cur.state !== "AWAITING_INBOUND") { pollDelivery(cur.id); return; } // already paid → watch, don't re-pay
      await send({ invoice: cur.payInstruction.code });
      pollDelivery(cur.id);
    } catch (e) {
      if (!mounted.current) return;
      setErr(errMsg(e));
      setBusy(false);
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
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{t("wallet_send_momo")}</div>
        <div style={{ display: "grid", placeItems: "center", gap: 8, padding: "8px 0" }}>
          {delivered
            ? <div style={{ fontSize: 30 }}>✅</div>
            : failed ? <div style={{ fontSize: 30 }}>⚠️</div>
            : <Spinner size={26} color="var(--accent)" />}
          <div style={{ fontSize: 15, fontWeight: 750, textAlign: "center" }}>
            {delivered ? t("wallet_delivered") : failed ? t("wallet_cant_deliver") : err ? t("wallet_not_sent") : t("wallet_settling")}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", textAlign: "center" }}>
            {fmtXaf(payment.xaf)} XAF → {rec.name || rec.phone} · {PROVIDERS[rec.provider]?.short ?? rec.provider} {COUNTRIES[rec.country]?.dial} {rec.phone}
          </div>
          <div className="num" style={{ fontSize: 11, color: "var(--ink-3)" }}>{payment.ref} · {payment.state.toLowerCase().replace(/_/g, " ")}</div>
        </div>
        {err ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 4, textAlign: "center" }}>{err}</div> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {err && !delivered && !failed && (
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => { void retryPay(); }}>
              {busy ? <Spinner size={14} color="var(--accent-ink)" /> : t("wallet_try_again")}
            </button>
          )}
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { reset(); if (delivered || failed) onDone?.(); }}>{delivered || failed ? t("wallet_done") : t("wallet_close")}</button>
        </div>
      </div>
    );
  }

  // ---- Quote review ----
  if (quote) {
    // A buffer for the Lightning routing fee — paying exactly at balance would fail
    // for the fee. ~0.5% + 2 sats covers typical routing on signet/mainnet.
    const feeBuffer = Math.max(2, Math.ceil(needSats * 0.005));
    const short = spendable < needSats + feeBuffer;
    const secsLeft = Math.max(0, Math.round((Date.parse(quote.expiresAt) - now) / 1000));
    const expired = secsLeft <= 0;
    return (
      <div style={{ ...card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_confirm_transfer")}</div>
          <span className="num" style={{ fontSize: 11.5, color: expired ? "var(--bad)" : "var(--ink-3)" }}>
            {expired ? t("wallet_rate_expired") : `${t("wallet_rate_holds")} ${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`}
          </span>
        </div>
        <Row k={t("recipient")} v={`${name || digits} · ${PROVIDERS[provider]?.short ?? provider}`} />
        <Row k={t("wallet_they_receive")} v={`${fmtXaf(quote.xaf)} XAF`} strong />
        <Row k={t("wallet_you_pay")} v={`${fmtSats(needSats)} sats`} />
        <Row k={t("wallet_fee")} v={`${fmtXaf(quote.feeXaf)} XAF`} />
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "10px 0 0", lineHeight: 1.5 }}>
          {t("wallet_bridge_note")}
        </div>
        {expired ? <div style={{ fontSize: 12.5, color: "var(--warn-ink)", marginTop: 8 }}>{t("wallet_quote_expired_hint")}</div>
          : short ? <div style={{ fontSize: 12.5, color: "var(--warn-ink)", marginTop: 8 }}>{t("wallet_balance_is")} {fmtSats(spendable)} {t("wallet_not_enough_suffix")}</div> : null}
        {err ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{err}</div> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-ghost" style={{ flex: "0 0 auto" }} onClick={reset} disabled={busy}>{t("wallet_back")}</button>
          {expired
            ? <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => { void getQuote(); }}>
                {busy ? <Spinner size={15} color="var(--accent-ink)" /> : t("wallet_refresh_quote")}
              </button>
            : <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || short} onClick={() => { void payFromWallet(); }}>
                {busy ? <Spinner size={15} color="var(--accent-ink)" /> : t("wallet_pay_from_wallet")}
              </button>}
        </div>
      </div>
    );
  }

  // ---- Form ----
  const verified = nameSource === "provider" || nameSource === "internal";
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_send_momo")}</div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 12px", lineHeight: 1.5 }}>{t("wallet_momo_intro")}</p>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "0 11px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--ink-2)" }}>{COUNTRIES.CM.dial}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="6 XX XX XX XX" aria-label={t("recipient")} style={{ ...input, flex: 1, fontFamily: "var(--font-mono)" }} />
        </div>
        {digits.length >= 8 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--ink-2)" }}>
            {resolving ? <><Spinner size={12} color="var(--accent)" /> {t("wallet_checking")}</>
              : verified ? <span style={{ color: "var(--recv)" }}>✓ {name} · {PROVIDERS[provider]?.name}</span>
              : <input value={name} onChange={(e) => { setName(e.target.value); setNameSource("manual"); }} placeholder={t("wallet_recipient_name_ph")} style={{ ...input, padding: "8px 11px", fontSize: 13 }} />}
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
          <input value={xaf ? fmtXaf(amt) : ""} onChange={(e) => setXaf(e.target.value)} inputMode="numeric" placeholder={t("wallet_amount_ph")} aria-label={t("wallet_amount_ph")} style={{ ...input, flex: 1, fontFamily: "var(--font-mono)" }} />
          <span style={{ display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>XAF</span>
        </div>
        {amt > 0 && amt < MIN_XAF ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("wallet_minimum")} {fmtXaf(MIN_XAF)} XAF.</div> : null}
      </div>
      {err ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{err}</div> : null}
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={!canQuote} onClick={() => { void getQuote(); }}>
        {busy ? <Spinner size={15} color="var(--accent-ink)" /> : t("wallet_get_quote")}
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
  const { t } = useI18n();
  const { receive, receivePending, receiveError } = useWalletReceive();
  const activity = useWalletActivity();
  const [sats, setSats] = useState("");
  const [memo, setMemo] = useState("");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [invoiceInfo, setInvoiceInfo] = useState<{ amt: number; memo: string }>({ amt: 0, memo: "" });
  const [copied, setCopied] = useState(false);
  const amt = Number(sats.replace(/\D/g, "")) || 0;

  const gen = async () => {
    if (amt <= 0) return;
    const m = memo.trim();
    const r = await receive({ amountSat: amt, memo: m || undefined });
    setInvoice(r.invoice || null); setInvoiceInfo({ amt, memo: m }); setCopied(false);
  };
  // The daemon marks the matching receive Entry 'complete' once the invoice settles.
  const paid = invoice ? activity.some((e) => e.kind === "receive" && e.request?.lightningInvoice === invoice && e.status === "complete") : false;
  const copy = () => { if (!invoice) return; void navigator.clipboard?.writeText(invoice); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{t("wallet_receive")}</div>
      {WALLET_NETWORK === "signet" && (
        <div role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.45, color: "var(--warn-ink)", background: "var(--send-wash)", border: "1px solid var(--warn)", borderRadius: 10, padding: "8px 10px", marginBottom: 12 }}>
          <span aria-hidden style={{ flex: "0 0 auto" }}>⚠️</span>
          <span>{t("wallet_signet_notice")}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={sats} onChange={(e) => setSats(e.target.value)} inputMode="numeric" placeholder={t("wallet_amount_sats_ph")} aria-label={t("wallet_amount_sats_ph")} style={{ ...input, flex: "1 1 130px", fontFamily: "var(--font-mono)" }} />
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t("wallet_note_ph")} aria-label={t("wallet_note_ph")} maxLength={80} style={{ ...input, flex: "1 1 150px" }} />
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={receivePending || amt <= 0} onClick={() => { void gen(); }}>
        {receivePending ? <Spinner size={15} color="var(--accent-ink)" /> : t("wallet_generate_invoice")}
      </button>
      {receiveError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(receiveError.message ?? receiveError).slice(0, 120)}</div> : null}
      {invoice && (
        <div style={{ display: "grid", placeItems: "center", marginTop: 16, gap: 10 }}>
          <div style={{ textAlign: "center" }}>
            <div className="num" style={{ fontSize: 15, fontWeight: 750 }}>{t("wallet_receiving")} {fmtSats(invoiceInfo.amt)} <span style={{ fontSize: 12, color: "var(--ink-3)" }}>sats</span></div>
            {invoiceInfo.memo ? <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{invoiceInfo.memo}</div> : null}
          </div>
          <div style={{ background: "#fff", padding: 12, borderRadius: 14, opacity: paid ? 0.5 : 1, transition: "opacity .3s" }}><QR value={`lightning:${invoice}`} size={200} /></div>
          {paid
            ? <div style={{ fontSize: 14.5, fontWeight: 750, color: "var(--recv)", display: "inline-flex", alignItems: "center", gap: 6 }}><span>✓</span> {t("wallet_paid")}</div>
            : <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--ink-3)" }}><Spinner size={12} color="var(--accent)" /> {t("wallet_waiting_payment")}</div>}
          <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? t("wallet_copied") : t("wallet_copy_invoice")}</button>
        </div>
      )}
    </div>
  );
}

/** Pay a BOLT11 invoice from the wallet. */
function Send() {
  const { t } = useI18n();
  const { send, sendPending, sendError, sendData } = useWalletSend();
  const [bolt11, setBolt11] = useState("");
  const pay = async () => {
    const inv = bolt11.trim().replace(/^lightning:/i, "");
    if (!inv) return;
    await send({ invoice: inv });
  };
  const paste = async () => { try { const txt = await navigator.clipboard?.readText(); if (txt) setBolt11(txt.trim()); } catch { /* clipboard blocked */ } };
  return (
    <div style={{ ...card }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t("wallet_send")}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => { void paste(); }}>{t("wallet_paste")}</button>
      </div>
      <textarea value={bolt11} onChange={(e) => setBolt11(e.target.value)} placeholder={t("wallet_bolt11_ph")} aria-label={t("wallet_bolt11_ph")} rows={3}
        style={{ ...input, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12.5 }} />
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} disabled={sendPending || !bolt11.trim()} onClick={() => { void pay(); }}>
        {sendPending ? <Spinner size={15} color="var(--accent-ink)" /> : t("wallet_pay_invoice")}
      </button>
      {sendError ? <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 8 }}>{String(sendError.message ?? sendError).slice(0, 120)}</div> : null}
      {sendData ? <div style={{ fontSize: 13, color: "var(--recv)", fontWeight: 650, marginTop: 8 }}>{t("wallet_payment_sent")}</div> : null}
    </div>
  );
}

/* ---- helpers ---- */
/** Spendable balance = confirmed on-chain/channel funds plus available credit line.
 *  Pending-in is surfaced separately so the headline reflects what's usable now. */
function spendableSats(b: Balance): number {
  return Math.max(0, Math.round((b.confirmedSat ?? 0) + (b.creditAvailableSat ?? 0)));
}
function statusLabel(phase: string, t: (k: string) => string): string {
  switch (phase) {
    case "ready": return t("wallet_status_ready");
    case "syncing": return t("wallet_status_syncing");
    case "needsWallet": return t("wallet_status_setup");
    case "locked": return t("wallet_status_locked");
    case "error": return t("wallet_status_error");
    default: return t("wallet_status_starting");
  }
}
function fmtSats(n: number): string { return new Intl.NumberFormat("en-US").format(n); }
function fmtXaf(n: number): string { return new Intl.NumberFormat("fr-FR").format(Math.round(n)); }
function errMsg(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/^Error:\s*/, "").slice(0, 160);
}
