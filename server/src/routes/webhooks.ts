/* ============================================================
   Inbound rail webhooks. Raw body (for HMAC verification) → verify →
   parse → match payment by providerRef → drive the state machine.
   Acks fast; settlement runs async (BACKEND_DESIGN §2 ingestion).
   ============================================================ */
import express, { Router, type Request, type Response } from "express";
import { adapterByName } from "../adapters/index.js";
import { payoutByName } from "../adapters/payouts.js";
import { store } from "../db/store.js";
import { markDetected, confirmInbound } from "../core/stateMachine.js";
import * as peex from "../integrations/peex/service.js";
import { onPayoutResult } from "../core/stateMachine.js";
import { background } from "../core/background.js";

export const webhooks = Router();

/* ---------- payout (fiat) callbacks — dispatched through the PayoutAdapter ----------
   Every aggregator callback runs the SAME flow (verify → parse → authoritative re-query
   → settle), so a new fiat rail gets webhook handling for free: its verifyCallback /
   parseCallback live on its adapter. We ack fast, then settle ONLY on the AUTHORITATIVE
   queryStatus re-query — never the POSTed body status. (Peexit 404s fresh transactions
   for ~3 days, so the re-query is routinely inconclusive right when a callback fires;
   trusting the body there let a spoofed `failed` refund an already-paid payout. When the
   re-query is inconclusive we HOLD; reconcileStuckPayouts re-queries later.) */
function handlePayoutCallback(name: string, req: Request, res: Response): Response | void {
  const adapter = payoutByName(name);
  if (!adapter) return res.status(404).json({ error: "unknown_aggregator" });
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (adapter.verifyCallback && !adapter.verifyCallback(raw, req.headers)) return res.status(401).json({ error: "unauthorized" });
  let events;
  try { events = adapter.parseCallback ? adapter.parseCallback(JSON.parse(raw)) : []; }
  catch { return res.status(400).json({ error: "bad_json" }); }
  res.json({ ok: true }); // ack fast; settle in background
  for (const ev of events) {
    if (!adapter.statusByKey(ev.ref)) continue; // not one of ours
    background((async () => {
      const status = await adapter.queryStatus(ev.ref); // AUTHORITATIVE re-query
      if (status === "COMPLETED" || status === "FAILED") await onPayoutResult(ev.ref, status, ev.providerRef);
      // else: inconclusive → leave it; the reconcile backstop settles it.
    })());
  }
}

// Named routes (external providers are registered to these exact URLs) + a generic
// /payout/:name so a newly-plugged fiat rail is reachable with no route change.
webhooks.post("/peexit", express.raw({ type: "*/*" }), (req, res) => handlePayoutCallback("peexit", req, res));
webhooks.post("/pawapay", express.raw({ type: "*/*" }), (req, res) => handlePayoutCallback("pawapay", req, res));
webhooks.post("/payout/:name", express.raw({ type: "*/*" }), (req, res) => handlePayoutCallback(req.params.name, req, res));

// Peex intelligence-layer webhook — signature-verified, logged. Registered
// before the generic rail route. Failures here never affect payments.
webhooks.post("/peex", express.raw({ type: "*/*" }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const sig = req.headers["x-peex-signature"];
  const ok = peex.handleWebhook(raw, Array.isArray(sig) ? sig[0] : sig);
  res.status(ok ? 200 : 401).json({ ok });
});

// Raw body so the signature is computed over the exact bytes the provider signed.
webhooks.post("/:provider", express.raw({ type: "*/*" }), async (req, res) => {
  const adapter = adapterByName(req.params.provider);
  if (!adapter) return res.status(404).json({ error: "unknown_provider" });

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  // req.ip is resolved via app.set("trust proxy", 1) — pass it so an IP allowlist checks
  // the ACTUAL sender rather than a caller-supplied X-Forwarded-For value.
  if (!adapter.verifyWebhook(rawBody, req.headers, req.ip)) {
    return res.status(401).json({ error: "bad_signature" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "bad_json" });
  }

  const event = adapter.parseEvent(parsed);
  if (!event) return res.json({ ok: true, ignored: true });

  const payment = await store().findByProviderRef(event.providerRef);
  if (!payment) return res.json({ ok: true, unmatched: true });

  // Bind the webhook to the payment's ISSUING rail. Matching by providerRef ALONE would let
  // a webhook verified by rail X settle a payment minted on rail Y — so a forged webhook to a
  // fail-open / unconfigured rail (whose verifyWebhook can't reject) could settle a real IBEX
  // payment for crypto never received. Require the URL rail == the rail that minted the invoice.
  if ((payment.payInstruction.provider ?? "") !== req.params.provider) {
    return res.json({ ok: true, ignored: true }); // not this rail's payment — refuse to settle it
  }

  // Ack now; settle asynchronously.
  if (event.kind === "detected") {
    await markDetected(payment);
    return res.json({ ok: true });
  }
  res.json({ ok: true });
  // Authoritative re-confirm: never settle a LIGHTNING inbound on the webhook body alone.
  // Re-query the rail (any rail exposing confirmSettlement) so a forged
  // "settled" webhook — even one with a leaked secret — can't trigger a real payout for an
  // unpaid invoice.
  //
  // ONLY LIGHTNING. That is the one method whose providerRef is a transaction id the rail
  // can actually be asked about. Every DEPOSIT method — on-chain BTC and the ERC-20
  // stablecoins (USDT/USDC) — stores the RECEIVE ADDRESS as providerRef, and no rail can
  // answer "is this address settled?" from its transaction-by-id endpoint. Asking anyway is
  // not merely wasted: the answer comes back shaped like a verdict. IBEX's transactionStatus
  // derives `settled` purely from Lightning invoice fields, so for an address it answers
  // "not settled" — a falsy `settled` in a truthy object, which hit the `if (!s.settled)
  // return` below and DROPPED the settlement, so a deposit whose crypto had already landed
  // would never pay out. Gating here makes the code do what these comments describe.
  //
  // A deposit is therefore settled on its webhook body — which is still shared-secret gated
  // and sender-IP allowlisted, with the amount re-checked against the locked quote in
  // confirmInbound, and the reconcile backstop covering a webhook that never arrives.
  background((async () => {
    // Which leg was paid decides this too: a unified BIP-21 QR's Lightning leg IS
    // re-queryable (its ref is a transaction id) even though the payment itself is on-chain.
    const paidLeg = payment.payInstruction.alt?.providerRef === event.providerRef
      ? payment.payInstruction.alt
      : payment.payInstruction;
    if (adapter.confirmSettlement && paidLeg.method === "LIGHTNING") {
      const s = await adapter.confirmSettlement(event.providerRef).catch(() => null);
      if (s) { if (!s.settled) return; } // explicit verdict: not paid → ignore
      // Indeterminate (null: network failure, or the rail has no re-query). For REAL money
      // do NOT fall back to the webhook body — hold, and let the poll/reconcile backstop
      // settle the moment the rail can confirm. This stops a transient re-query failure from
      // quietly downgrading "never settle on the body alone" to "settle on a secret-gated
      // body". A non-real inbound moves no real money either way, so it proceeds.
      else if (adapter.trusted()) return;
    }
    await confirmInbound(payment, event.amount, event.eventId, event.providerRef);
  })());
});
