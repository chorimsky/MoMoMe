/* Feature flags for the Universal Payment Identity layer — every one OFF by default, every
   one independently switchable, read at call time (a Railway variable change is enough).
   docs/upi/ROLLBACK_PLAN.md says what each one turns off. */
import { UPI_FLAGS, type UpiFlag } from "../../../../shared/upi.js";
import { config } from "../../config.js";

export function flag(name: UpiFlag): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}
export function flags(): Record<UpiFlag, boolean> {
  return Object.fromEntries(UPI_FLAGS.map((f) => [f, flag(f)])) as Record<UpiFlag, boolean>;
}
/** SHADOW: routes are computed and recorded beside V1's choice, never executed. EXECUTE
 *  additionally requires MULTI_RAIL_ROUTING_ENABLED. */
export function routingMode(): "SHADOW" | "EXECUTE" {
  return (process.env.ROUTING_ENGINE_MODE ?? "SHADOW").toUpperCase() === "EXECUTE" && flag("MULTI_RAIL_ROUTING_ENABLED") ? "EXECUTE" : "SHADOW";
}
/** Corridor-level canary: CORRIDOR_CM_KE_ENABLED=true (never all at once; the network layer's
 *  own `settings.network.corridors` switch must ALSO be on — two hands on the valve). */
export function corridorFlag(src: string, dst: string): boolean {
  return (process.env[`CORRIDOR_${src}_${dst}_ENABLED`] ?? "").trim().toLowerCase() === "true";
}
/** In the sandbox the whole surface is reachable for rehearsal, exactly like /api/network. */
export const upiReachable = (): boolean => flag("UNIVERSAL_PAYMENT_IDENTITY_ENABLED") || config.railsMode === "sandbox";
