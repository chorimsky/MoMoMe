/* ============================================================
   Treasury withdrawal — an admin sweeps the platform's accumulated crypto
   inventory (held in the IBEX accounts) out to pre-configured wallet addresses.
   Real money. The core safety rule: NEVER sweep crypto still owed to a sender —
   withdrawable = live rail balance − liabilities (crypto for held / refund-pending
   payments). Super-Admin only (enforced at the route); every withdrawal is audited.
   ============================================================ */
import type { PaymentState, TreasuryPool, TreasuryRail, TreasuryWithdrawal } from "../../../shared/types.js";
import { btcToMsat, msatToBtc } from "../../../shared/domain.js";
import { config } from "../config.js";
import { getSettings } from "./settings.js";
import { store } from "../db/store.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";
import { accountBalances, sendOnchain, payLightningAddress } from "../adapters/ibex.js";

type Asset = "BTC" | "USDT" | "USDC";

/** States in which we HOLD inbound crypto that may still be owed to the sender, so
 *  it must never be swept. Everything else is safe: DELIVERED crypto is ours (we
 *  paid the XAF), REFUNDED went back, FAILED/AWAITING never received crypto. */
const HELD: PaymentState[] = ["INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "MANUAL_REVIEW", "REFUND_PENDING"];

const RAILS: Record<Asset, TreasuryRail[]> = { BTC: ["lightning", "onchain"], USDT: ["usdt"], USDC: ["usdc"] };
const RAIL_ASSET: Record<TreasuryRail, Asset> = { lightning: "BTC", onchain: "BTC", usdt: "USDT", usdc: "USDC" };
const accountFor: Record<Asset, () => string> = {
  BTC: () => config.ibex.accountId, USDT: () => config.ibex.usdtAccountId, USDC: () => config.ibex.usdcAccountId,
};

/* Audit log — append-only, persisted (most-recent first). */
const withdrawals: TreasuryWithdrawal[] = [];
register("treasury", () => withdrawals.slice(0, 200), (d: TreasuryWithdrawal[]) => { withdrawals.push(...d); });
export function withdrawalHistory(): TreasuryWithdrawal[] { return withdrawals.slice(0, 50); }
function record(e: TreasuryWithdrawal): void {
  withdrawals.unshift(e);
  if (withdrawals.length > 200) withdrawals.pop();
  touch("treasury");
}

// Serialize withdrawals so two concurrent sweeps can't each pass the withdrawable
// ceiling (which doesn't net out in-flight sends) and over-draw the treasury.
let wChain: Promise<unknown> = Promise.resolve();
function withWithdrawLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = wChain.then(fn, fn);
  wChain = run.then(() => {}, () => {});
  return run;
}
/** An identical withdrawal (same rail, amount, actor) not-yet-failed within the
 *  window is a double-submit — return it instead of sending crypto twice. */
function recentWithdrawal(rail: TreasuryRail, amount: number, by: string, windowMs = 90_000): TreasuryWithdrawal | undefined {
  const now = Date.now();
  return withdrawals.find((w) => w.rail === rail && w.amount === amount && w.by === by && w.status !== "failed" && now - Date.parse(w.at) < windowMs);
}

/** IBEX account balance (smallest unit, by currencyId) → the asset's natural unit. */
function toDisplay(currencyId: number, bal: number): number {
  if (currencyId === 0) return msatToBtc(bal);         // MSAT → BTC
  if (currencyId === 1) return bal / 1e8;             // SATS → BTC
  if (currencyId === 2) return bal;                   // BTC
  if (currencyId === 29 || currencyId === 30) return bal / 1e6; // USDT/USDC base units
  return bal;
}

/** Crypto owed to senders whose payment is still held (received-but-not-delivered),
 *  per asset, in display units. */
export async function cryptoLiabilities(): Promise<Record<Asset, number>> {
  const out: Record<Asset, number> = { BTC: 0, USDT: 0, USDC: 0 };
  for (const p of await store().listPayments()) {
    if (!HELD.includes(p.state)) continue;
    const a = p.payInstruction.asset as Asset;
    if (a in out) out[a] += p.payInstruction.amount;
  }
  // Plus every duplicate deposit still owed back. Those sit on payments that are
  // DELIVERED — the order really was filled — so the state-based scan above counts their
  // crypto as OURS and would have let an operator sweep money belonging to the sender.
  // The debt lives on the ledger instead, as a credit balance on refund_payable (credits
  // are negative in this debit-positive sum), and is a liability until it is refunded.
  for (const a of ["BTC", "USDT", "USDC"] as Asset[]) {
    out[a] += Math.max(0, -(await store().balance("refund_payable", a)));
  }
  return out;
}

/** Real balances + liabilities + safely-withdrawable per crypto pool. Live balances
 *  come from IBEX; if that fetch fails, balanceKnown=false and withdrawable=0 (fail
 *  safe — never offer a sweep against an unknown balance). */
export async function treasuryPools(): Promise<TreasuryPool[]> {
  const liab = await cryptoLiabilities();
  let balances: Record<string, { currencyId: number; balance: number }> | null = null;
  try { balances = await accountBalances(); } catch { balances = null; }
  return (["BTC", "USDT", "USDC"] as Asset[]).map((asset) => {
    const acct = accountFor[asset]();
    const row = balances && acct ? balances[acct] : undefined;
    const balanceKnown = !!row;
    const balance = row ? toDisplay(row.currencyId, row.balance) : 0;
    const liabilities = liab[asset];
    const withdrawable = balanceKnown ? Math.max(0, balance - liabilities) : 0;
    return { asset, rails: RAILS[asset], balance, liabilities, withdrawable, balanceKnown };
  });
}

/** Execute a treasury withdrawal. Enforces: a configured destination, the rail is
 *  supported/enabled, and the amount is within the LIVE withdrawable ceiling (so a
 *  sweep can never dip into crypto owed to senders). Records an audit entry either
 *  way. `by` is the acting admin's username. */
export async function withdraw(rail: TreasuryRail, amount: number, by: string): Promise<{ ok: boolean; error?: string; entry?: TreasuryWithdrawal }> {
  const asset = RAIL_ASSET[rail];
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "bad_amount" };
  const t = getSettings().treasury;
  const dest = rail === "lightning" ? t.lnAddress : rail === "onchain" ? t.btcOnchain : rail === "usdt" ? t.usdtAddress : t.usdcAddress;
  if (!dest) return { ok: false, error: "no_destination" };
  // Stablecoin send is not enabled on the IBEX org yet (receive returns 403) and the
  // crypto-send flow is unverified — fail closed rather than guess a real transfer.
  if (rail === "usdt" || rail === "usdc") return { ok: false, error: "stablecoin_unavailable" };
  return withWithdrawLock(async () => {
  const dupe = recentWithdrawal(rail, amount, by);
  if (dupe) return { ok: false, error: "duplicate", entry: dupe };
  // Live withdrawable ceiling — refuse if we can't confirm the balance, or the amount
  // would eat into sender-owed crypto.
  const pool = (await treasuryPools()).find((p) => p.asset === asset);
  if (!pool || !pool.balanceKnown) return { ok: false, error: "balance_unavailable" };
  if (amount > pool.withdrawable + 1e-12) return { ok: false, error: "exceeds_withdrawable" };

  const entry: TreasuryWithdrawal = { id: id("tw"), at: new Date().toISOString(), rail, asset, amount, destination: dest, by, status: "sent" };
  try {
    if (rail === "lightning") {
      const r = await payLightningAddress(dest, btcToMsat(amount));
      entry.txId = r.transactionId;
      entry.status = r.settled ? "settled" : "sent";
    } else { // onchain
      const r = await sendOnchain(dest, btcToMsat(amount)); // BTC account unit is msat
      entry.txId = r.txId;
      entry.status = "sent";
    }
  } catch (e) {
    entry.status = "failed";
    entry.error = e instanceof Error ? e.message : "send_failed";
    record(entry);
    console.error(`[treasury] withdraw FAILED ${amount} ${asset} via ${rail} by ${by}: ${entry.error}`);
    return { ok: false, error: entry.error, entry };
  }
  record(entry);
  console.log(`[treasury] withdraw ${amount} ${asset} via ${rail} → ${dest} by ${by} (${entry.status}, tx=${entry.txId ?? "-"})`);
  return { ok: true, entry };
  });
}
