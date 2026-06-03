/* Seed historical payments so Activity / Admin / Ops have data on boot. */
import type { Payment, Method, CountryCode, ProviderId, DisplayStatus, PaymentState } from "../../shared/types.js";
import { putPayment } from "./core/store.js";
import { ensureIdentity, claimIdentity } from "./core/identity.js";
import { seedMerchants } from "./core/merchant.js";
import * as peex from "./integrations/peex/service.js";

interface Seed {
  name: string; phone: string; country: CountryCode; provider: ProviderId;
  xaf: number; status: DisplayStatus; method: Method; ref: string; daysAgo: number;
}

const SEEDS: Seed[] = [
  { name: "MBARGA ALICE", phone: "6 82 41 09 33", country: "CM", provider: "MTN", xaf: 25000, status: "Completed", method: "LIGHTNING", ref: "MMM-2026-418842", daysAgo: 0 },
  { name: "FOTSO MARIE", phone: "6 90 55 18 72", country: "CM", provider: "ORANGE", xaf: 120000, status: "Completed", method: "ONCHAIN", ref: "MMM-2026-418771", daysAgo: 1 },
  { name: "OWONA PIERRE", phone: "0 74 22 88 10", country: "GA", provider: "AIRTEL", xaf: 15000, status: "Pending", method: "USDT", ref: "MMM-2026-418702", daysAgo: 1 },
  { name: "TCHOUMI PAUL", phone: "6 78 33 21 55", country: "CM", provider: "MTN", xaf: 30000, status: "Completed", method: "LIGHTNING", ref: "MMM-2026-418655", daysAgo: 6 },
  { name: "ETOA SANDRINE", phone: "6 95 41 88 70", country: "CM", provider: "ORANGE", xaf: 75000, status: "Failed", method: "USDT", ref: "MMM-2026-418610", daysAgo: 7 },
  { name: "NGASSA DANIEL", phone: "6 70 19 02 44", country: "CM", provider: "MTN", xaf: 10000, status: "Completed", method: "LIGHTNING", ref: "MMM-2026-418544", daysAgo: 8 },
  { name: "ABENA CLAIRE", phone: "6 63 12 09 44", country: "TD", provider: "MTN", xaf: 200000, status: "Completed", method: "ONCHAIN", ref: "MMM-2026-418401", daysAgo: 10 },
];

const STATE: Record<DisplayStatus, PaymentState> = {
  Completed: "DELIVERED",
  Pending: "MANUAL_REVIEW",
  Failed: "FAILED",
};

export function seed() {
  for (const s of SEEDS) {
    const at = new Date(Date.now() - s.daysAgo * 86400_000).toISOString();
    const fee = Math.round(s.xaf * 0.025);
    const p: Payment = {
      id: `seed_${s.ref}`,
      ref: s.ref,
      quoteId: `seed_q_${s.ref}`,
      state: STATE[s.status],
      displayStatus: s.status,
      method: s.method,
      recipient: { phone: s.phone, country: s.country, provider: s.provider, name: s.name, nameSource: "provider" },
      xaf: s.xaf,
      feeXaf: fee,
      totalXaf: s.xaf + fee,
      usd: (s.xaf + fee) / 607,
      payInstruction: { method: s.method, code: "", qr: "", asset: s.method === "USDT" ? "USDT" : "BTC", amount: 0, amountLabel: "", expiresAt: at },
      events: [{ at, state: STATE[s.status] }],
      createdAt: at,
      updatedAt: at,
    };
    putPayment(p);
    // Provision the recipient's custodial identity (Phase 1).
    ensureIdentity(p.recipient, s.ref);
    // Optional Peex enrichment (non-blocking) so the panel has data on boot.
    void peex.enrich(p);
  }
  // A couple of early adopters have already claimed their account (Phase 2).
  claimIdentity("CUS00001");
  claimIdentity("CUS00004");
  // Seed the merchant identity graph.
  seedMerchants();
}
