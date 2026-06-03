/* ============================================================
   Admin settings — server-side source of truth (in-memory; swap for
   a settings table behind the same interface). Powers the Settings
   and Crypto Rails config screens.
   ============================================================ */
import type { AdminSettings } from "../../../shared/types.js";
import { FEE_PCT, RAIL_SPREAD_BPS } from "../../../shared/domain.js";
import { register, touch } from "./persist.js";

let settings: AdminSettings = {
  company: { brand: "MoMo›Me", email: "help@momome.app", phone: "+237 233 00 00 00" },
  channels: { Email: true, SMS: true, WhatsApp: false },
  rails: { defaultRail: "Lightning", autoSwitch: true, threshold: 200000 },
  pricing: { feePct: FEE_PCT, spreadBps: { ...RAIL_SPREAD_BPS } },
};

register("settings", () => settings, (d: AdminSettings) => { settings = d; });

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
  };
  touch("settings");
  return settings;
}
