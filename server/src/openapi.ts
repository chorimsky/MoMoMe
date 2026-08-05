/* ============================================================
   OpenAPI 3.1 description of the MoMo›Me developer API.
   Served (with the live base URL) at GET /api/openapi.json and rendered by the
   /developers docs portal. Keep in sync with the routes in routes/api.ts.
   ============================================================ */

/** Build the spec with the deployment's real base URL injected. */
export function openApiSpec(publicUrl: string) {
  const base = `${publicUrl.replace(/\/$/, "")}/api`;
  return {
    openapi: "3.1.0",
    info: {
      title: "MoMo›Me API",
      version: "1.0.0",
      description:
        "Turn Bitcoin, Lightning and stablecoins into instant Mobile Money payouts (MTN & Orange, XAF) across Cameroon/CEMAC. " +
        "The flow is: create a **quote** (locks the rate), create a **payment** from it (returns a crypto pay instruction), " +
        "pay the instruction, then poll the payment or receive a webhook until it is `DELIVERED`.",
      contact: { name: "MoMo›Me", url: "https://momome.xyz/developers" },
    },
    servers: [{ url: base, description: "Live API" }],
    security: [{ apiKey: [] }, { bearerAuth: [] }],
    tags: [
      { name: "Quotes", description: "Lock an exchange rate for a payout amount." },
      { name: "Payments", description: "Create and track a crypto → Mobile Money payment." },
      { name: "Recipients", description: "Resolve a Mobile Money number to an operator and name." },
    ],
    paths: {
      "/quotes": {
        post: {
          tags: ["Quotes"], summary: "Create a quote", operationId: "createQuote",
          description: "Locks the FX rate for a payout of `xaf` via the given crypto `method`. The quote expires (`expiresAt`); create a payment before then.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteRequest" }, examples: { lightning: { value: { xaf: 50000, method: "LIGHTNING", country: "CM" } } } } } },
          responses: {
            "200": { description: "Quote created", content: { "application/json": { schema: { $ref: "#/components/schemas/Quote" } } } },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "503": { description: "Rates temporarily unavailable", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/payments": {
        post: {
          tags: ["Payments"], summary: "Create a payment", operationId: "createPayment",
          description: "Creates a payment from a quote and returns the `payInstruction` — the Lightning invoice / on-chain or TRC-20 address to pay. Once the inbound is confirmed the Mobile Money payout is delivered automatically.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePaymentRequest" }, examples: { basic: { value: { quoteId: "qt_…", recipient: { phone: "677000789", country: "CM", provider: "MTN", name: "NANA JEAN" } } } } } } },
          responses: {
            "200": { description: "Payment created", content: { "application/json": { schema: { $ref: "#/components/schemas/Payment" } } } },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "409": { description: "Quote expired — request a new quote", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/payments/{id}": {
        get: {
          tags: ["Payments"], summary: "Get a payment", operationId: "getPayment",
          description: "Returns the current state of a payment you created. Poll this (or use webhooks) until `state` is `DELIVERED`, `REFUNDED` or `FAILED`.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "Payment id (e.g. `pay_…`)" }],
          responses: {
            "200": { description: "The payment", content: { "application/json": { schema: { $ref: "#/components/schemas/Payment" } } } },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/recipients/resolve": {
        get: {
          tags: ["Recipients"], summary: "Resolve a Mobile Money number", operationId: "resolveRecipient",
          description: "Detects the operator (MTN/Orange) for a number and, when available, the account holder's name.",
          parameters: [
            { name: "phone", in: "query", required: true, schema: { type: "string" }, description: "Local Mobile Money number, e.g. `677000789`" },
            { name: "country", in: "query", required: false, schema: { $ref: "#/components/schemas/CountryCode" } },
          ],
          responses: { "200": { description: "Resolution result", content: { "application/json": { schema: { $ref: "#/components/schemas/ResolveResult" } } } } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "Your secret key, e.g. `mk_…`." },
        bearerAuth: { type: "http", scheme: "bearer", description: "`Authorization: Bearer mk_…`." },
      },
      responses: {
        BadRequest: { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Unauthorized: { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        NotFound: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
      schemas: {
        CountryCode: { type: "string", enum: ["CM", "GA", "TD", "CG", "CF"], description: "CEMAC country (ISO-3166 alpha-2)." },
        Method: { type: "string", enum: ["LIGHTNING", "ONCHAIN", "USDT"], description: "Inbound crypto rail the sender pays with." },
        ProviderId: { type: "string", enum: ["MTN", "ORANGE"], description: "Mobile Money operator." },
        Error: { type: "object", properties: { error: { type: "string", description: "Stable machine code, e.g. `quote_expired`." }, message: { type: "string", description: "Human-readable explanation." } }, required: ["error", "message"] },
        QuoteRequest: { type: "object", required: ["xaf", "method", "country"], properties: { xaf: { type: "integer", minimum: 500, description: "Amount delivered to the recipient, in XAF." }, method: { $ref: "#/components/schemas/Method" }, country: { $ref: "#/components/schemas/CountryCode" } } },
        Quote: {
          type: "object",
          properties: {
            id: { type: "string" }, xaf: { type: "integer" }, feeXaf: { type: "integer" }, totalXaf: { type: "integer" },
            method: { $ref: "#/components/schemas/Method" }, inboundAsset: { type: "string", enum: ["BTC", "USDT", "USDC"] },
            inboundAmount: { type: "number", description: "Amount to pay, in the inbound asset." }, inboundAmountLabel: { type: "string", example: "0.00042100 BTC" },
            rate: { type: "number" }, usd: { type: "number" }, spreadBps: { type: "integer" },
            issuedAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" }, estimateOnly: { type: "boolean" },
          },
        },
        Recipient: { type: "object", required: ["phone", "country", "provider", "name"], properties: { phone: { type: "string" }, country: { $ref: "#/components/schemas/CountryCode" }, provider: { $ref: "#/components/schemas/ProviderId" }, name: { type: "string", description: "Recipient's name (used on the payout)." }, nameSource: { type: "string", enum: ["provider", "internal", "manual", "unknown", "idle"] } } },
        CreatePaymentRequest: { type: "object", required: ["quoteId", "recipient"], properties: { quoteId: { type: "string" }, recipient: { $ref: "#/components/schemas/Recipient" } } },
        PayInstruction: {
          type: "object",
          properties: {
            method: { $ref: "#/components/schemas/Method" },
            code: { type: "string", description: "BOLT11 invoice (Lightning) or on-chain / TRC-20 address." },
            qr: { type: "string", description: "String to encode in a QR." },
            asset: { type: "string", enum: ["BTC", "USDT", "USDC"] }, amount: { type: "number" }, amountLabel: { type: "string" },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        PaymentState: { type: "string", enum: ["QUOTED", "AWAITING_INBOUND", "INBOUND_DETECTED", "INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED", "REFUND_PENDING", "REFUNDED", "FAILED", "MANUAL_REVIEW"] },
        Payment: {
          type: "object",
          properties: {
            id: { type: "string" }, ref: { type: "string", example: "MMM-2026-418842" }, quoteId: { type: "string" },
            state: { $ref: "#/components/schemas/PaymentState" }, displayStatus: { type: "string", enum: ["Completed", "Pending", "Failed"] },
            method: { $ref: "#/components/schemas/Method" }, recipient: { $ref: "#/components/schemas/Recipient" },
            xaf: { type: "integer" }, feeXaf: { type: "integer" }, totalXaf: { type: "integer" }, usd: { type: "number" },
            payInstruction: { $ref: "#/components/schemas/PayInstruction" },
            createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
          },
        },
        ResolveResult: { type: "object", properties: { status: { type: "string", enum: ["provider", "internal", "unknown"] }, name: { type: "string", nullable: true }, provider: { $ref: "#/components/schemas/ProviderId" } } },
      },
    },
  } as const;
}
