/* ============================================================
   Feature-switch settings — a super-admin can enable/disable any product
   surface (AdminSettings.features), and the merge is non-breaking.

   Covers: the default set includes every surface (incl. the MVP-composition
   flags merchant/receive/contacts) all-ON; updateSettings persists a
   toggle and leaves siblings untouched; and a PARTIAL features patch (an older
   client that omits the newer keys) preserves the omitted flags rather than
   dropping them to undefined.

   Route-level enforcement (getSettings().features.X → 403 in the handlers) is
   inline in routes/api.ts; this asserts the settings mechanism those reads sit on.
   Run: pnpm --filter @momome/server test:settings-features
   ============================================================ */
import assert from "node:assert/strict";
import type { AdminSettings } from "../../shared/types.js";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { getSettings, updateSettings } = await import("../src/core/settings.js");
  const ALL_KEYS: (keyof AdminSettings["features"])[] = [
    "directory", "scanToPay", "referrals", "invoices", "developerApi", "diaspora",
    "merchant", "receive", "contacts",
  ];

  console.log("\nFeature switches — defaults");
  const f0 = getSettings().features;
  ok("every product surface has a flag", ALL_KEYS.every((k) => typeof f0[k] === "boolean"), Object.keys(f0).join(","));
  ok("MVP-composition flags present (merchant/receive/contacts)",
    ["merchant", "receive", "contacts"].every((k) => k in f0));
  ok("defaults are all-ON (nothing hidden out of the box)", ALL_KEYS.every((k) => f0[k] === true));

  console.log("\nFeature switches — a super-admin toggles surfaces off (MVP)");
  const next = updateSettings({ features: { ...f0, merchant: false, contacts: false } });
  ok("merchant off persisted", next.features.merchant === false);
  ok("contacts off persisted", next.features.contacts === false);
  ok("contacts off persisted", next.features.contacts === false);
  ok("untouched siblings stay on (directory/scanToPay/receive)",
    next.features.directory === true && next.features.scanToPay === true && next.features.receive === true);
  ok("getSettings() reflects the change", getSettings().features.merchant === false);

  console.log("\nFeature switches — partial patch is non-breaking");
  // An older client that only knows the original 6 keys must not drop the newer 4.
  updateSettings({ features: { ...getSettings().features, referrals: false } as AdminSettings["features"] });
  const legacyPatch = { directory: true, scanToPay: true, referrals: true, invoices: true, developerApi: true, diaspora: true };
  const merged = updateSettings({ features: legacyPatch as unknown as AdminSettings["features"] });
  ok("legacy 6-key patch preserves merchant flag (still false)", merged.features.merchant === false);
  ok("legacy patch preserves contacts flag (still false)", merged.features.contacts === false);
  ok("legacy patch still applies its own keys (referrals back on)", merged.features.referrals === true);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
