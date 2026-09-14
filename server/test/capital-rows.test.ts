/* Per-row durability for capital collections: only changed rows are written, removed rows are
   deleted, and boot restores from rows (rows win over the snapshot).
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/capital-rows.test.ts */
process.env.DB_PATH = ":memory:"; process.env.RAILS_MODE = "sandbox";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const rows = await import("../src/core/capital/rows.js");
  const inv = await import("../src/core/capital/investors.js");
  const table = new Map<string, Map<string, unknown>>();
  const writes: string[] = [], deletes: string[] = [];
  rows._setRowBackend({
    active: () => true,
    upsert: async (c, id, body) => { writes.push(`${c}:${id}`); (table.get(c) ?? table.set(c, new Map()).get(c)!).set(id, JSON.parse(JSON.stringify(body))); },
    remove: async (c, id) => { deletes.push(`${c}:${id}`); table.get(c)?.delete(id); },
    all: async (c) => [...(table.get(c)?.values() ?? [])],
  });
  const a = inv.createInvestor({ name: "Row One", type: "VC", country: "CM" }, "t");
  const b = inv.createInvestor({ name: "Row Two", type: "VC", country: "CM" }, "t");
  await rows.rowsSettled();
  if (!a.ok || !b.ok) throw new Error("create failed");
  ok("each create writes its own row (plus the notification rows)", writes.filter((w) => w.startsWith("capital_investors:")).length === 2, writes.join(","));
  writes.length = 0;
  inv.qualifyInvestor(a.value.id, "QUALIFIED", 80, "fit", "t");
  await rows.rowsSettled();
  ok("a mutation writes ONLY the changed investor row", writes.filter((w) => w.startsWith("capital_investors:")).length === 1 && writes.includes(`capital_investors:${a.value.id}`), writes.join(","));
  ok("nothing written for the untouched investor", !writes.includes(`capital_investors:${b.value.id}`));
  // Simulate a cold boot on another instance: memory empty, rows are the source.
  inv._resetInvestorOs();
  ok("memory cleared", inv.listInvestors().length === 0);
  await rows.hydrateCapitalRows();
  const restored = inv.listInvestors();
  ok("boot restores both investors from rows", restored.length === 2 && restored.find((i) => i.id === a.value.id)?.qualification.status === "QUALIFIED");
  // A row removed from memory (pending adjustment approved) is deleted from the table.
  const adj = inv.proposeAdjustment({ capitalType: "OWN", amount: 10, memo: "row test" }, "one");
  await rows.rowsSettled();
  if (!adj.ok) throw new Error("adjust failed");
  ok("pending adjustment row written", table.get("capital_pending_adjustments")?.has(adj.value.id) === true);
  inv.decideAdjustment(adj.value.id, false, "two");
  await rows.rowsSettled();
  ok("rejected adjustment row deleted", deletes.includes(`capital_pending_adjustments:${adj.value.id}`) && !table.get("capital_pending_adjustments")?.has(adj.value.id));
  rows._setRowBackend(null);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
