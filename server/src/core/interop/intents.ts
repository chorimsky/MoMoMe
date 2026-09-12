/* ============================================================
   Payment intents + idempotency — persisted, owner-scoped.

   An intent is what the user wants; the engine Payment (core/stateMachine) is how a route
   executes it. Intents never hold money state themselves — status is derived from the
   linked payment on read, so the two can never disagree.

   Idempotency: (owner, Idempotency-Key) → the reply already given. A retried POST returns
   the SAME reply and creates nothing. Keys live 24 h.
   ============================================================ */
import type { PaymentIntent, PaymentRoute } from "../../../../shared/interop.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";

const intents = new Map<string, PaymentIntent>();
const routes = new Map<string, PaymentRoute>();
const idem = new Map<string, { at: number; status: number; body: unknown }>();
register("interop_intents", () => ({ intents: [...intents.values()], routes: [...routes.values()], idem: [...idem.entries()] }),
  (d: { intents?: PaymentIntent[]; routes?: PaymentRoute[]; idem?: Array<[string, { at: number; status: number; body: unknown }]> }) => {
    for (const i of d?.intents ?? []) intents.set(i.id, i);
    for (const r of d?.routes ?? []) routes.set(r.id, r);
    for (const [k, v] of d?.idem ?? []) idem.set(k, v);
  });

export function newIntent(base: Omit<PaymentIntent, "id" | "createdAt" | "updatedAt" | "status" | "availableRoutes" | "routeId" | "paymentId" | "paymentRef" | "riskStatus" | "complianceStatus" | "sourceCurrency">): PaymentIntent {
  const now = new Date().toISOString();
  const it: PaymentIntent = { ...base, id: id("pi"), status: "CREATED", availableRoutes: [], routeId: null, paymentId: null, paymentRef: null, sourceCurrency: null, riskStatus: "unknown", complianceStatus: "unknown", createdAt: now, updatedAt: now };
  intents.set(it.id, it); touch("interop_intents");
  return it;
}
export function getIntent(intentId: string): PaymentIntent | undefined { return intents.get(intentId); }
export function saveIntent(it: PaymentIntent): void { it.updatedAt = new Date().toISOString(); intents.set(it.id, it); touch("interop_intents"); }
export function intentsOf(owner: string): PaymentIntent[] { return [...intents.values()].filter((i) => i.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

export function saveRoute(r: PaymentRoute): void { routes.set(r.id, r); touch("interop_intents"); }
export function getRoute(routeId: string): PaymentRoute | undefined { return routes.get(routeId); }
export function routesOf(intentId: string): PaymentRoute[] { return [...routes.values()].filter((r) => r.intentId === intentId); }

const IDEM_TTL = 24 * 3600_000;
export function idemLookup(owner: string, key: string): { status: number; body: unknown } | undefined {
  const hit = idem.get(`${owner} ${key}`);
  if (!hit) return undefined;
  if (Date.now() - hit.at > IDEM_TTL) { idem.delete(`${owner} ${key}`); return undefined; }
  return { status: hit.status, body: hit.body };
}
export function idemStore(owner: string, key: string, status: number, body: unknown): void {
  if (idem.size > 50_000) { const k = idem.keys().next().value; if (k) idem.delete(k); }
  idem.set(`${owner} ${key}`, { at: Date.now(), status, body });
  touch("interop_intents");
}
/** Valid client key: 8–128 printable ASCII characters. */
export const validIdemKey = (k: unknown): k is string => typeof k === "string" && k.length >= 8 && k.length <= 128 && /^[!-~]+$/.test(k);
