# Lightning settlement

`lightningRail` wraps the existing rail registry (IBEX Hub priority 0, phoenixd for LUD-06 `description_hash`, sandbox). `initiate` = `createInstruction({ method: "LIGHTNING" })` — the same disposable BOLT11 V1 mints; status, detection and confirmation stay with V1 (webhook + poll); health from the rail health tracker. Outbound (paying invoices) exists in V1 for refunds and the network's settlement leg (`core/network/settlement.ts`); the UPI layer does not add a second sender.

Lightning Address: `<E.164 digits>@momome.xyz` (LUD-16 → LUD-06). The phone number is the identity; the address is its interoperable representation. `getDestinations()` lists it beside Mobile Money. External wallets pay the address; they are **not** told a bare phone number works in them (MOMOME_WALLET_INTEROPERABILITY.md).
