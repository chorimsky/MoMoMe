/* ============================================================
   Inbound rail webhooks. Raw body (for HMAC verification) → verify →
   parse → match payment by providerRef → drive the state machine.
   Acks fast; settlement runs async (BACKEND_DESIGN §2 ingestion).
   ============================================================ */
import express, { Router } from "express";
import { adapterByName } from "../adapters/index.js";
import { findByProviderRef } from "../core/store.js";
import { markDetected, confirmInbound } from "../core/stateMachine.js";
import * as peex from "../integrations/peex/service.js";
import * as pawapay from "../adapters/pawapay.js";
import * as peexit from "../adapters/peexit.js";
import { onPayoutResult } from "../core/stateMachine.js";

export const webhooks = Router();

// Peexit payout callback — the second aggregator's async confirmation/failure.
webhooks.post("/peexit", express.raw({ type: "*/*" }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const sig = req.headers["x-peexit-signature"];
  if (!peexit.verifyWebhook(raw, Array.isArray(sig) ? sig[0] : sig)) return res.status(401).json({ error: "bad_signature" });
  let event;
  try { event = peexit.parsePayoutEvent(JSON.parse(raw)); } catch { return res.status(400).json({ error: "bad_json" }); }
  if (!event) return res.json({ ok: true, ignored: true });
  void onPayoutResult(event.ref, event.status).catch((e) => console.error("peexit payout result", event!.ref, e));
  res.json({ ok: true });
});

// PawaPay payout callback — the async confirmation/failure of a Mobile Money
// payout. Signature-verified; drives delivery or auto-refund. Acks fast.
webhooks.post("/pawapay", express.raw({ type: "*/*" }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const sig = req.headers["x-pawapay-signature"];
  if (!pawapay.verifyWebhook(raw, Array.isArray(sig) ? sig[0] : sig)) {
    return res.status(401).json({ error: "bad_signature" });
  }
  let event;
  try { event = pawapay.parsePayoutEvent(JSON.parse(raw)); } catch { return res.status(400).json({ error: "bad_json" }); }
  if (!event) return res.json({ ok: true, ignored: true });
  void onPayoutResult(event.ref, event.status).catch((e) => console.error("payout result", event!.ref, e));
  res.json({ ok: true });
});

// Peex intelligence-layer webhook — signature-verified, logged. Registered
// before the generic rail route. Failures here never affect payments.
webhooks.post("/peex", express.raw({ type: "*/*" }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const sig = req.headers["x-peex-signature"];
  const ok = peex.handleWebhook(raw, Array.isArray(sig) ? sig[0] : sig);
  res.status(ok ? 200 : 401).json({ ok });
});

// Raw body so the signature is computed over the exact bytes the provider signed.
webhooks.post("/:provider", express.raw({ type: "*/*" }), (req, res) => {
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

  const payment = findByProviderRef(event.providerRef);
  if (!payment) return res.json({ ok: true, unmatched: true });

  // Ack now; settle asynchronously.
  if (event.kind === "detected") {
    markDetected(payment);
  } else {
    void confirmInbound(payment, event.amount).catch((e) => console.error("settle error", payment.id, e));
  }
  res.json({ ok: true });
});
