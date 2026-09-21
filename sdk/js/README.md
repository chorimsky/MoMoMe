# @momome/sdk

Typed client for the MoMo›Me API v1 — Bitcoin, Lightning and stablecoin payouts into African Mobile Money.
Aligned with `GET /v1/openapi.json`; every method is an `operationId` there.

```ts
import { MoMoMe, verifyWebhookSignature } from "@momome/sdk";

const momome = new MoMoMe(process.env.MOMOME_KEY!); // mm_test_… → sandbox, mm_live_… → production

const quote = await momome.quotes.create({ source: { asset: "USDT", network: "ETHEREUM" }, destination: { country: "CM", amount: "25000" } });
const payment = await momome.payments.create({ quote_id: quote.id, reference: "ORDER-1", recipient: { phone: "+237670123456" } }, { idempotencyKey: "ORDER-1" });
console.log(payment.payment_instructions?.uri);            // show as a QR
const settled = await momome.payments.waitUntilSettled(payment.id);
console.log(settled.status);                                // COMPLETED

// Express webhook
app.post("/momome", express.raw({ type: "*/*" }), async (req, res) => {
  if (!(await verifyWebhookSignature(req.body, req.header("x-momome-signature"), process.env.MOMOME_WEBHOOK_SECRET!))) return res.sendStatus(400);
  const event = JSON.parse(req.body.toString());
  if (event.type === "payment.completed") { /* mark the order paid — dedupe on event.id */ }
  res.sendStatus(200);
});
```

Errors throw `MoMoMeError { status, code, message, details, requestId }`. Docs: https://momome.xyz/developers
