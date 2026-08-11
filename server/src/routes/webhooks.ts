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
  if (!adapter.verifyWebhook(rawBody, req.headers)) {
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

  // Ack now; settle asynchronously.
  if (event.kind === "detected") {
    await markDetected(payment);
    return res.json({ ok: true });
  }
  res.json({ ok: true });
  // Authoritative re-confirm: never settle on the webhook body alone. Re-query the
  // rail (any rail exposing confirmSettlement — IBEX, Blink, …) so a forged "settled"
  // webhook — even one with a leaked secret — can't trigger a real payout for an
  // unpaid invoice. confirmSettlement returns null when it can't determine (e.g. an
  // on-chain address) or the rail has no re-query, in which case we fall back to the
  // verified webhook (still secret-gated, amount re-checked in confirmInbound); only
  // an EXPLICIT not-settled result is rejected.
  background((async () => {
    if (adapter.confirmSettlement) {
      const s = await adapter.confirmSettlement(event.providerRef).catch(() => null);
      if (s && !s.settled) return; // the rail says this inbound is not paid — ignore
    }
    await confirmInbound(payment, event.amount);
  })());
});
