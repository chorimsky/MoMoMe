/* ============================================================
   Admin settings — server-side source of truth (in-memory; swap for
   a settings table behind the same interface). Powers the Settings
   and Crypto Rails config screens.
   ============================================================ */
import type { AdminSettings } from "../../../shared/types.js";
import { FEE_PCT, RAIL_SPREAD_BPS, MAX_XAF } from "../../../shared/domain.js";
import { register, touch } from "./persist.js";

const DEFAULTS: AdminSettings = {
  company: { brand: "MoMo›Me", email: "help@momome.app", phone: "+237 233 00 00 00" },
  channels: { Email: true, SMS: true, WhatsApp: false },
  rails: { defaultRail: "Lightning", autoSwitch: true, threshold: 200000 },
  pricing: { feePct: FEE_PCT, spreadBps: { ...RAIL_SPREAD_BPS } },
  // Default: accept payments, approval threshold at the corridor max (effectively
  // off until an operator lowers it — e.g. for live money).
  ops: { acceptingPayments: true, payoutApprovalXaf: MAX_XAF },
};

let settings: AdminSettings = DEFAULTS;

// Hydrate from persistence, back-filling any section absent in an older blob
// (e.g. `ops` added later) so getSettings() is always fully populated.
register("settings", () => settings, (d: Partial<AdminSettings>) => {
  settings = {
    company: { ...DEFAULTS.company, ...(d.company ?? {}) },
    channels: { ...DEFAULTS.channels, ...(d.channels ?? {}) },
    rails: { ...DEFAULTS.rails, ...(d.rails ?? {}) },
    pricing: { feePct: d.pricing?.feePct ?? DEFAULTS.pricing.feePct, spreadBps: { ...DEFAULTS.pricing.spreadBps, ...(d.pricing?.spreadBps ?? {}) } },
    ops: { ...DEFAULTS.ops, ...(d.ops ?? {}) },
  };
});

export function getSettings(): AdminSettings {
  return settings;
}

/** Shallow-merge each top-level section; callers send complete sections. */
export function updateSettings(patch: Partial<AdminSettings>): AdminSettings {
  settings = {
    company: { ...settings.company, ...(patch.company ?? {}) },
    channels: { ...settings.channels, ...(patch.channels ?? {}) },
    rails: { ...settings.rails, ...(patch.rails ?? {}) },
    pricing: {
      feePct: patch.pricing?.feePct ?? settings.pricing.feePct,
      spreadBps: { ...settings.pricing.spreadBps, ...(patch.pricing?.spreadBps ?? {}) },
    },
    ops: { ...settings.ops, ...(patch.ops ?? {}) },
  };
  touch("settings");
  return settings;
}
