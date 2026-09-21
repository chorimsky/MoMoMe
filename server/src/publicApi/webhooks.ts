/* ============================================================
   /v1/webhooks — endpoints an organization registers to hear about its payments.

   POST   /webhooks              { url, events?: [...], description? } → endpoint + ONE-TIME secret
   GET    /webhooks              list
   GET    /webhooks/:id          one, with recent deliveries
   PATCH  /webhooks/:id          { url?, events?, enabled?, description? }
   DELETE /webhooks/:id
   POST   /webhooks/:id/test     sends a `ping` event now
   POST   /webhooks/:id/replay   { event_id } re-delivers a past event
   GET    /webhooks/:id/deliveries

   Delivery: POST <url> with
     X-MoMoMe-Signature: t=<unix-ms>,v1=<hex hmac-sha256(secret, `${t}.${body}`)>
     X-MoMoMe-Event-Id:  evt_…   (idempotency key for the receiver)
   Body: { id, object:"event", type, created_at, livemode, data }. Retries 1 s → 10 s →
   1 min → 10 min → 1 h, then dead-lettered (visible here and replayable). 50 consecutive
   failures disable the endpoint (re-enable with PATCH enabled:true).
   ============================================================ */
import { route, auditCtx, type Ctx } from "./index.js";
import { err } from "./errors.js";
import { subscribe, listSubscriptions, getSubscription, updateSubscription, removeSubscription, enqueueEvent, replayEvent, eventsOf, type Subscription } from "../core/interop/outbound.js";
import { EVENT_TYPES } from "../core/platform/mapping.js";
import { meter } from "../core/platform/usage.js";

const owner = (ctx: Ctx) => `org:${ctx.orgId}`;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const view = (s: Subscription) => ({ id: s.id, object: "webhook_endpoint", url: s.url, events: s.events, enabled: !s.disabledAt, description: s.description ?? null, secret_hint: s.secretHint, consecutive_failures: s.failures, created_at: s.createdAt, ...(s.disabledAt ? { disabled_at: s.disabledAt } : {}) });
const validEvents = (v: unknown): string[] | null => {
  if (v === undefined) return ["*"];
  if (!Array.isArray(v) || !v.length) return null;
  const ev = v.map((x) => str(x)).filter(Boolean);
  return ev.every((e) => e === "*" || (EVENT_TYPES as readonly string[]).includes(e) || e === "ping") ? ev : null;
};

route("post", "/webhooks", { scope: "webhooks:manage", idempotent: true, cls: "webhooks" }, async (ctx: Ctx) => {
  const url = str(ctx.body.url);
  if (!url) throw err(422, "validation_failed", "`url` is required (public https).", { field: "url" });
  const events = validEvents(ctx.body.events);
  if (!events) throw err(422, "validation_failed", "`events` must be a non-empty list of known event types (or [\"*\"]).", { field: "events", known: EVENT_TYPES });
  const r = subscribe(owner(ctx), url, events, ctx.env === "test");
  if (!r.ok) throw err(r.reason.includes("at most") ? 409 : 422, r.reason.includes("at most") ? "webhook_limit" : "webhook_url_invalid", r.reason, { field: "url" });
  if (str(ctx.body.description)) updateSubscription(owner(ctx), r.sub.id, { description: str(ctx.body.description) });
  auditCtx(ctx, "webhook.created", { type: "webhook_endpoint", id: r.sub.id }, { url });
  ctx.status = 201;
  return { ...view(getSubscription(owner(ctx), r.sub.id)!), secret: r.secret, note: "Store the secret now — it is not shown again. Verify X-MoMoMe-Signature with it." };
});
route("get", "/webhooks", { scope: "webhooks:manage", cls: "webhooks" }, async (ctx: Ctx) => ({ object: "list", data: listSubscriptions(owner(ctx)).map(view) }));
route("get", "/webhooks/:id", { scope: "webhooks:manage", cls: "webhooks" }, async (ctx: Ctx) => {
  const s = getSubscription(owner(ctx), ctx.params.id); if (!s) throw err(404, "webhook_not_found", "No such webhook endpoint.");
  return { ...view(s), recent_deliveries: eventsOf(owner(ctx), s.id, 20).map(delivery) };
});
route("patch", "/webhooks/:id", { scope: "webhooks:manage", cls: "webhooks" }, async (ctx: Ctx) => {
  const s = getSubscription(owner(ctx), ctx.params.id); if (!s) throw err(404, "webhook_not_found", "No such webhook endpoint.");
  const events = ctx.body.events === undefined ? undefined : validEvents(ctx.body.events);
  if (events === null) throw err(422, "validation_failed", "`events` must be a non-empty list of known event types.", { field: "events", known: EVENT_TYPES });
  const r = updateSubscription(owner(ctx), s.id, { url: str(ctx.body.url) || undefined, events: events ?? undefined, enabled: typeof ctx.body.enabled === "boolean" ? ctx.body.enabled : undefined, description: typeof ctx.body.description === "string" ? ctx.body.description : undefined }, ctx.env === "test");
  if (!r.ok) throw err(422, "webhook_url_invalid", r.reason, { field: "url" });
  auditCtx(ctx, "webhook.updated", { type: "webhook_endpoint", id: s.id });
  return view(r.sub);
});
route("delete", "/webhooks/:id", { scope: "webhooks:manage", cls: "webhooks" }, async (ctx: Ctx) => {
  if (!removeSubscription(owner(ctx), ctx.params.id)) throw err(404, "webhook_not_found", "No such webhook endpoint.");
  auditCtx(ctx, "webhook.deleted", { type: "webhook_endpoint", id: ctx.params.id });
  return { id: ctx.params.id, object: "webhook_endpoint", deleted: true };
});
route("post", "/webhooks/:id/test", { scope: "webhooks:manage", cls: "webhooks" }, async (ctx: Ctx) => {
  const s = getSubscription(owner(ctx), ctx.params.id); if (!s) throw err(404, "webhook_not_found", "No such webhook endpoint.");
  const ids = enqueueEvent(owner(ctx), "ping", { message: "MoMo›Me webhook test", endpoint_id: s.id, at: new Date().toISOString() }, { onlySub: s.id });
  if (!ids.length) {
    // The endpoint may not subscribe to `ping`; send it anyway for a test.
    updateSubscription(owner(ctx), s.id, { events: [...new Set([...s.events, "ping"])] });
    const again = enqueueEvent(owner(ctx), "ping", { message: "MoMo›Me webhook test", endpoint_id: s.id, at: new Date().toISOString() }, { onlySub: s.id });
    updateSubscription(owner(ctx), s.id, { events: s.events });
    ids.push(...again);
  }
  meter(ctx.orgId, ctx.env, "webhooks");
  return { sent: true, event_ids: ids };
});
route("post", "/webhooks/:id/replay", { scope: "webhooks:manage", cls: "webhooks" }, async (ctx: Ctx) => {
  const s = getSubscription(owner(ctx), ctx.params.id); if (!s) throw err(404, "webhook_not_found", "No such webhook endpoint.");
  const eventId = str(ctx.body.event_id);
  if (!eventId) throw err(422, "validation_failed", "`event_id` is required.", { field: "event_id" });
  if (!replayEvent(owner(ctx), eventId)) throw err(404, "not_found", "No such event for this organization.");
  auditCtx(ctx, "webhook.replayed", { type: "webhook_endpoint", id: s.id }, { eventId });
  return { replayed: true, event_id: eventId };
});
route("get", "/webhooks/:id/deliveries", { scope: "webhooks:manage", cls: "webhooks" }, async (ctx: Ctx) => {
  const s = getSubscription(owner(ctx), ctx.params.id); if (!s) throw err(404, "webhook_not_found", "No such webhook endpoint.");
  return { object: "list", data: eventsOf(owner(ctx), s.id, Math.min(100, Number(ctx.query.limit ?? 50) || 50)).map(delivery) };
});
const delivery = (e: ReturnType<typeof eventsOf>[number]) => ({ event_id: e.id, type: e.type, created_at: e.createdAt, attempts: e.attempts, status: e.deliveredAt ? "delivered" : e.dead ? "dead" : "pending", delivered_at: e.deliveredAt ?? null, next_attempt_at: e.deliveredAt || e.dead ? null : e.nextAt, last_http_status: e.lastStatus ?? null, last_error: e.lastError ?? null, event: e.event });
