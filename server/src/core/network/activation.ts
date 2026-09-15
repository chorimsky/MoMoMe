/* ============================================================
   Corridor activation checklist (PHASE 6 → 7).

   The mandate: "do not activate a corridor because the API exists". This is the list an
   operator walks before the switch goes on, computed from the same facts the router uses
   — markets, adapters, FX, liquidity, flags, canary controls, shadow evidence and the
   reconciliation. A must-have that is missing blocks activation; a warn is advisory.
   Nothing here changes state; it only says what is true right now.
   ============================================================ */
import type { ChecklistItem, CorridorChecklist } from "../../../../shared/network.js";
import { liveMoney } from "../../config.js";
import { getSettings } from "../settings.js";
import { adaptersFor } from "./adapters.js";
import { fxLive } from "./fx.js";
import { canSettle, destinationSources, sources, sourceSideSource } from "./liquidity.js";
import { market } from "./markets.js";
import { PROVIDER_CODES, activeProviders } from "./pawapayMarkets.js";
import { allTx } from "./saga.js";
import { reconcile, shadowReport } from "./shadow.js";

const item = (key: string, label: string, ok: boolean, detail: string, severity: ChecklistItem["severity"] = "must"): ChecklistItem => ({ key, label, ok, detail, severity });

export async function corridorChecklist(corridor: string): Promise<CorridorChecklist | null> {
  const [srcCode, dstCode] = corridor.split("-");
  const src = market(srcCode), dst = market(dstCode);
  if (!src || !dst) return null;
  const n = getSettings().network;
  const domestic = srcCode === dstCode;
  const items: ChecklistItem[] = [];

  // 1. Configuration — markets, providers, corridor switch.
  items.push(item("market_src", `${src.name} enabled as a market`, src.enabled, src.enabled ? "enabled" : "switch it on under Markets"));
  items.push(item("market_dst", `${dst.name} enabled as a market`, dst.enabled, dst.enabled ? "enabled" : "switch it on under Markets"));
  const collecting = src.providers.filter((p) => p.collect).map((p) => p.id), paying = dst.providers.filter((p) => p.payout).map((p) => p.id);
  items.push(item("providers_src", "A collecting provider in the source market", collecting.length > 0, collecting.join(", ") || "no provider has collect = on"));
  items.push(item("providers_dst", "A paying provider in the destination market", paying.length > 0, paying.join(", ") || "no provider has payout = on"));
  if (!domestic) items.push(item("corridor_on", "Corridor switched on", !!n.corridors[corridor], n.corridors[corridor] ? "on" : "off"));

  // 2. Rails — real, configured, live; PawaPay's own confirmation of the codes we use.
  const col = adaptersFor(srcCode).filter((a) => collecting.some((p) => a.supports(p, "collect")));
  const pay = adaptersFor(dstCode).filter((a) => paying.some((p) => a.supports(p, "payout")));
  const realCol = col.filter((a) => !a.simulated && a.configured()), realPay = pay.filter((a) => !a.simulated && a.configured());
  items.push(item("rail_collect", "A real collection rail is configured", realCol.length > 0, realCol.map((a) => a.id).join(", ") || (col.length ? `only ${col.map((a) => a.id).join(", ")} (simulated)` : "none")));
  items.push(item("rail_payout", "A real payout rail is configured", realPay.length > 0, realPay.map((a) => a.id).join(", ") || (pay.length ? `only ${pay.map((a) => a.id).join(", ")} (simulated)` : "none")));
  items.push(item("rail_payout_live", "The payout rail is on its production endpoint", realPay.some((a) => a.live()), realPay.some((a) => a.live()) ? "live" : "sandbox or not configured", "warn"));
  if (realPay.some((a) => a.aggregator === "pawapay") && PROVIDER_CODES[dstCode]) {
    const conf = await activeProviders(dstCode, "PAYOUT");
    const want = paying.map((p) => PROVIDER_CODES[dstCode][p]).filter(Boolean);
    const missing = conf ? want.filter((c) => !conf.includes(c)) : [];
    items.push(item("pawapay_conf", "PawaPay active-conf lists every provider code we pay", conf != null && missing.length === 0, conf == null ? "active-conf unreachable — confirm manually" : missing.length ? `missing: ${missing.join(", ")}` : want.join(", "), conf == null ? "warn" : "must"));
  }
  const health = realPay.map((a) => a.getProviderHealth());
  items.push(item("rail_health", "Payout rail healthy", health.length > 0 && health.every((h) => h.status === "OPERATIONAL" || h.status === "SANDBOX"), health.map((h) => h.status).join(", ") || "no rail", "warn"));

  // 3. Money — FX on a feed, Lightning position, destination liquidity.
  if (!domestic) {
    const fx = fxLive(src.currency, dst.currency);
    items.push(item("fx_live", `${src.currency}→${dst.currency} priced on a feed`, fx.live, fx.live ? "live" : fx.reasons.join("; "), liveMoney() ? "must" : "warn"));
    const ln = sources().find((s) => s.kind === "lightning" && s.status === "ACTIVE");
    items.push(item("lightning", "A Lightning position is available", !!ln, ln ? ln.id : "no Lightning source active"));
    items.push(item("flag_ln", "LIGHTNING_SETTLEMENT_V2 on (real settlement leg)", n.flags.LIGHTNING_SETTLEMENT_V2, n.flags.LIGHTNING_SETTLEMENT_V2 ? "on" : "off — the leg is rehearsed", "warn"));
  }
  const dsts = paying.flatMap((p) => destinationSources(dstCode, p));
  const settle = await Promise.all(dsts.map((s) => canSettle(s.id, dst.limits.minPerTx)));
  const okDst = settle.some((r) => r.ok);
  items.push(item("liquidity_dst", "Destination liquidity can fund a payout", okDst, dsts.length ? dsts.map((s, i) => `${s.id}: ${settle[i].available == null ? "unknown" : Math.round(settle[i].available!)} ${dst.currency}`).join(" · ") : "no destination source"));
  const floor = dsts.map((s) => n.liquidityFloor[s.id] ?? 0);
  items.push(item("liquidity_floor", "Destination liquidity above the alert floor", dsts.every((_, i) => (settle[i].available ?? 0) > floor[i]), floor.some(Boolean) ? `floors ${floor.join("/")}` : "no floor set — set one under liquidity floors", floor.some(Boolean) ? "warn" : "warn"));
  const srcPool = sourceSideSource(srcCode);
  items.push(item("pool_src", "Source-side pool present", !!srcPool, srcPool?.id ?? "none"));

  // 4. Flags & canary — the execution gate's inputs.
  const flags: Array<keyof typeof n.flags> = ["INTEROPERABILITY_V2", "ROUTING_ENGINE", "LIQUIDITY_ENGINE", ...(domestic ? [] : ["CROSS_BORDER_PAYMENTS" as const])];
  for (const f of flags) items.push(item(`flag_${f}`, `${f} on`, n.flags[f], n.flags[f] ? "on" : "off"));
  if (!domestic) {
    const perTx = n.canary.maxPerTx[corridor], perDay = n.canary.maxPerDay[corridor];
    items.push(item("cap_tx", "Per-transaction canary cap set", typeof perTx === "number" && perTx > 0, perTx ? `${perTx} ${src.currency}` : "not set"));
    items.push(item("cap_day", "Daily canary cap set", typeof perDay === "number" && perDay > 0, perDay ? `${perDay} ${src.currency} / 24 h` : "not set"));
    const admitted = n.canary.allowlist.length > 0 || n.canary.rolloutPct > 0;
    items.push(item("canary_who", "Someone is admitted (allowlist or rollout share)", admitted, n.canary.allowlist.length ? `${n.canary.allowlist.length} device(s) listed · rollout ${n.canary.rolloutPct} %` : `rollout ${n.canary.rolloutPct} %`));
  }

  // 5. Evidence — shadow agreement, reconciliation, recent failures.
  const sh = shadowReport();
  items.push(item("shadow", "Shadow routing agrees with production (≥ 20 comparisons, ≥ 95 %)", sh.comparisons >= 20 && sh.agreeing / Math.max(1, sh.comparisons) >= 0.95, `${sh.comparisons} comparisons · ${sh.agreeing} agreeing`, "warn"));
  const rc = reconcile();
  items.push(item("reconciliation", "Reconciliation clean", rc.stuck === 0 && rc.unmatched === 0, `${rc.stuck} stuck · ${rc.unmatched} unmatched · ${rc.manual} manual`, "warn"));
  const since = Date.now() - 24 * 60 * 60_000;
  const recent = allTx(2000).filter((t) => t.corridor === corridor && !t.shadow && Date.parse(t.createdAt) >= since);
  const failed = recent.filter((t) => t.state.endsWith("FAILED") || t.state === "MANUAL_REVIEW").length;
  items.push(item("recent_failures", "No failed executions on this corridor in 24 h", failed === 0, `${recent.length} execution(s) · ${failed} failed`, "warn"));

  const musts = items.filter((i) => i.severity === "must");
  const ready = musts.every((i) => i.ok);
  const configured = musts.filter((i) => ["market_src", "market_dst", "providers_src", "providers_dst", "rail_collect", "rail_payout", "fx_live", "pool_src", "liquidity_dst", "lightning"].includes(i.key)).every((i) => i.ok);
  const stage: CorridorChecklist["stage"] = !configured ? "not_configured" : !ready ? "rehearsal" : n.canary.rolloutPct >= 100 ? "live" : "canary";
  return { corridor, ready, stage, items };
}

/** Checklists for every corridor that could exist (both markets enabled, or switched on). */
export async function checklists(ids: string[]): Promise<CorridorChecklist[]> {
  const out: CorridorChecklist[] = [];
  for (const id of ids) { const c = await corridorChecklist(id); if (c) out.push(c); }
  return out;
}
