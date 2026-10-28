/* ============================================================
   Deterministic routing — which path can carry this intent, and which is best.

   The order is fixed and every check is recorded on the route so an operator (or a test)
   sees WHY a route was or was not chosen:
     1. destination supported (address resolved, active, within limits)
     2. source rail available (method on offer AND a real rail can serve it)
     3. compliant (kill-switch, reserved/blocked destinations, approval threshold → review)
     4. operational (the crypto rail and a payout rail are eligible right now)
     5. liquidity (a funded live payout rail for the destination operator)
     6. fees (quote from the ONE quote implementation)
     7. select: viable routes ranked by cost, then speed, then reliability
   No AI. More sophisticated scoring plugs into `score()` without touching the checks.
   ============================================================ */
import type { Method, ProviderId, QuoteRequest, Quote } from "../../../../shared/types.js";
import type { PaymentAddress, PaymentIntent, PaymentQuote, PaymentRoute } from "../../../../shared/interop.js";
import { METHOD_META, MIN_XAF } from "../../../../shared/domain.js";
import { activeRails, railHealth, methodServable } from "../../adapters/index.js";
import { payoutsFor, type PayoutAdapter } from "../../adapters/payouts.js";
import { payoutHealth, selectFundedAggregator } from "../routing.js";
import { getSettings } from "../settings.js";
import { liveMoney } from "../../config.js";
import { availableFloatXaf } from "../stateMachine.js";
import { railOfMethod } from "./rails.js";
import { id } from "../ids.js";
import { saveRoute } from "./intents.js";
import { engine as complianceEngine } from "./compliance.js";
import { feePctForOwner } from "../apiKeys.js";

const ETA: Record<Method, number> = { LIGHTNING: 5, ONCHAIN: 1800, USDT: 180, USDC: 180 };

/** Turn an engine Quote into the rail-neutral PaymentQuote. */
export function toPaymentQuote(q: Quote, destinationCurrency: string): PaymentQuote {
  const rate = q.inboundAmount > 0 ? q.totalXaf / q.inboundAmount : 0;
  return {
    amount: q.xaf, destinationCurrency, sourceCurrency: q.inboundAsset, sourceAmount: q.inboundAmount, sourceAmountLabel: q.inboundAmountLabel,
    exchangeRate: rate, providerFee: 0, platformFee: q.feeXaf, networkFee: 0, totalFee: q.feeXaf, recipientAmount: q.xaf,
    estimatedSeconds: ETA[q.method], estimateOnly: !!q.estimateOnly, expiresAt: q.expiresAt, quoteId: q.id,
  };
}

export type QuoteFn = (input: QuoteRequest & { feePct?: number }) => Promise<{ status: number; body: Quote | { error: string; message: string } }>;

/** Enumerate and check every candidate route for the intent. All routes are saved (viable
 *  or not) so the decision is auditable; the intent keeps the viable ids. */
export async function discoverRoutes(intent: PaymentIntent, dest: PaymentAddress, buildQuote: QuoteFn): Promise<PaymentRoute[]> {
  const out: PaymentRoute[] = [];
  const now = new Date().toISOString();
  const settings = getSettings();
  const country = dest.country ?? "CM";
  const mmRail = dest.rails.find((r) => r.rail === "mobile_money");
  const operator = (mmRail?.provider ?? null) as ProviderId | null;
  const candidates: Method[] = intent.preferredMethod ? [intent.preferredMethod] : (["LIGHTNING", "USDT", "USDC", "ONCHAIN"] as Method[]);

  // Shared destination checks — computed once, stamped on every route.
  const destChecks: PaymentRoute["checks"] = [];
  destChecks.push({ name: "destination_supported", ok: dest.status === "ACTIVE" && !!operator, detail: dest.status !== "ACTIVE" ? `address ${dest.status.toLowerCase()}` : undefined });
  const lim = dest.limits;
  destChecks.push({ name: "within_limits", ok: !!lim && intent.amount >= lim.min && intent.amount <= lim.max && intent.amount >= MIN_XAF, detail: lim ? `${lim.min}–${lim.max} ${lim.currency}` : "no limits known" });
  destChecks.push({ name: "accepting_payments", ok: settings.ops.acceptingPayments, detail: settings.ops.acceptingPayments ? undefined : "operator paused payments" });
  const needsApproval = intent.amount >= settings.ops.payoutApprovalXaf;
  // Sandbox/demo deployments settle through the simulator (as selectFundedAggregator does);
  // a live-money deployment needs a real, eligible payout rail.
  const simulated = !liveMoney();
  const payoutRails = operator ? payoutsFor(operator).filter((p) => p.configured()) : [];
  const payoutEligible = payoutRails.filter((p) => payoutHealth(p.name).eligible);
  // "Eligible" is the health tracker's opinion, and the tracker only learns from payout
  // ATTEMPTS. A rail nobody has tried since its API hostname stopped resolving is therefore
  // still eligible, with a success rate of 1 — Peexit sat in exactly that state for days:
  // reported operational, named to the sender as the destination party, and incapable of
  // paying anyone. A rail whose balance we cannot read is not operational, whatever the
  // tracker believes. The read is the adapter's own 15 s-cached one, so asking costs no
  // extra network call on the send path.
  const reachable: PayoutAdapter[] = [];
  const unreadable: string[] = [];
  if (operator) {
    for (const p of payoutEligible) {
      // A sandbox rail has no real wallet: null there means "not live", not "unreachable".
      if (!p.live()) { reachable.push(p); continue; }
      const bal = await p.balance(country, operator).catch(() => null);
      if (bal != null && Number.isFinite(bal)) reachable.push(p);
      else unreadable.push(p.name);
    }
  }
  destChecks.push({
    name: "payout_rail_operational",
    ok: reachable.length > 0 || simulated,
    detail: reachable.length ? reachable.map((p) => p.name).join(",")
      : simulated ? "simulated (sandbox deployment)"
      : unreadable.length ? `unreachable: ${unreadable.join(",")}`
      : payoutEligible.length ? "none eligible"
      : "no payout rail configured for this operator",
  });
  let liquidityOk = false; let liquidityDetail = "";
  if (operator) {
    const agg = await selectFundedAggregator(operator, country, intent.amount, false).catch(() => null);
    const float = await availableFloatXaf().catch(() => 0);
    liquidityOk = !!agg && float >= intent.amount;
    // "No funded payout rail" reads as "we are out of money", and that is what the sender
    // was shown while the real cause was a rail we could not reach at all. Report the two
    // apart — the same unknown-is-not-zero distinction payoutReady() already makes and this
    // check used to collapse.
    // "No funded payout rail" is true but useless when the rail IS reachable and its float
    // is simply short for THIS carrier — which is the live case: an account holding money,
    // none of it allocated to the MTN or Orange float the payout would debit. Name the
    // carrier and the figure, so the fix (top up that carrier) is readable from the refusal.
    const carrierFloats = await Promise.all(reachable.map(async (p) => ({ name: p.name, bal: await p.balance(country, operator).catch(() => null) })));
    const short = carrierFloats.filter((c) => c.bal != null && c.bal < intent.amount);
    liquidityDetail = agg ? `${agg.name}; float ${Math.round(float)} XAF`
      : reachable.length === 0 && unreadable.length ? `no payout rail reachable (${unreadable.join(",")})`
      : short.length ? `${operator} float short: ${short.map((c) => `${c.name} ${Math.round(c.bal!)} XAF`).join(", ")} (need ${intent.amount})`
      : "no funded payout rail";
  }
  destChecks.push({ name: "liquidity", ok: liquidityOk, detail: liquidityDetail });

  for (const method of candidates) {
    const checks: PaymentRoute["checks"] = [...destChecks];
    const rail = railOfMethod(method);
    const offered = settings.methods[method] && methodServable(method);
    checks.push({ name: "source_rail_available", ok: offered, detail: offered ? undefined : "method not on offer on this deployment" });
    const cryptoRail = activeRails().find((r) => r.supports(method) && (r.name !== "sandbox" || simulated));
    const ch = cryptoRail ? railHealth(cryptoRail.name) : null;
    checks.push({ name: "source_rail_operational", ok: !!ch?.eligible, detail: cryptoRail ? cryptoRail.name : "no real rail" });
    const screen = await complianceEngine.screenTransaction({ owner: intent.owner, recipientPhone: dest.value, recipientName: dest.owner.displayName ?? undefined, country, xaf: intent.amount, merchantCode: dest.type === "MERCHANT_CODE" ? dest.value : null });
    checks.push({ name: "compliance", ok: screen.verdict !== "blocked", detail: screen.verdict === "blocked" ? screen.flags.join("; ") : screen.verdict === "review" || needsApproval ? `will hold for operator review — ${[...screen.flags, ...(needsApproval ? ["above approval threshold"] : [])].join("; ")}` : "clear" });

    let quote: PaymentQuote | null = null;
    let quoteDetail: string | undefined;
    if (checks.every((c) => c.ok)) {
      const r = await buildQuote({ xaf: intent.amount, method, country, feePct: feePctForOwner(intent.owner) });
      if (r.status === 200) quote = toPaymentQuote(r.body as Quote, dest.currency ?? "XAF");
      else quoteDetail = (r.body as { message?: string }).message ?? "quote refused";
    }
    checks.push({ name: "quote", ok: !!quote, detail: quoteDetail });
    const viable = checks.every((c) => c.ok) && !!quote;
    const meta = METHOD_META[method];
    const route: PaymentRoute = {
      id: id("rt"), intentId: intent.id,
      steps: [
        { rail, provider: cryptoRail?.name ?? "-", currency: quote?.sourceCurrency ?? (method === "USDT" || method === "USDC" ? method : "BTC"), role: "source", party: cryptoRail?.name === "phoenixd" ? "MoMo›Me node" : cryptoRail?.name === "sandbox" ? "Simulator (no real money)" : "IBEX Hub (licensed crypto rail)" },
        { rail, provider: "momome", currency: dest.currency ?? "XAF", role: "conversion", party: "MoMo›Me (orchestration, FX lock, fee)" },
        { rail: "mobile_money", provider: reachable[0]?.name ?? (simulated ? "sandbox" : "-"), currency: dest.currency ?? "XAF", role: "destination", party: `${reachable[0]?.name ?? (simulated ? "simulated payout" : "payout aggregator")} → ${operator ?? "operator"}` },
      ],
      sourceRail: rail, sourceProvider: cryptoRail?.name ?? "-", sourceCurrency: quote?.sourceCurrency ?? "?",
      conversionRequired: true,
      destinationRail: "mobile_money", destinationProvider: operator ?? "-", destinationCurrency: dest.currency ?? "XAF",
      method,
      quote: quote ?? { amount: intent.amount, destinationCurrency: dest.currency ?? "XAF", sourceCurrency: "?", sourceAmount: 0, sourceAmountLabel: "-", exchangeRate: 0, providerFee: 0, platformFee: 0, networkFee: 0, totalFee: 0, recipientAmount: intent.amount, estimatedSeconds: ETA[method], estimateOnly: method === "ONCHAIN", expiresAt: now, quoteId: "" },
      score: score(method, quote, ch?.successRate ?? 0, !!meta.fast),
      checks, viable, status: "PROPOSED", createdAt: now,
    };
    saveRoute(route);
    out.push(route);
  }
  // Rank: viable first; then the composite score (cost, speed, reliability).
  return out.sort((a, b) => Number(b.viable) - Number(a.viable) || b.score.total - a.score.total);
}

/** 0..1 components, higher is better. Deterministic and explainable. */
function score(method: Method, q: PaymentQuote | null, successRate: number, fast: boolean): PaymentRoute["score"] {
  const cost = q ? Math.max(0, 1 - (q.totalFee / Math.max(1, q.amount)) * 10) : 0; // a 2.5% fee scores 0.75
  const speed = fast ? 1 : method === "ONCHAIN" ? 0.2 : 0.6;
  const reliability = successRate;
  return { cost, speed, reliability, total: Math.round((cost * 0.5 + speed * 0.3 + reliability * 0.2) * 1000) / 1000 };
}
