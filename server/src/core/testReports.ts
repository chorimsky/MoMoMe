/* ============================================================
   Tester reports — what comes back from momome.xyz/test.

   A tester runs the shared checklist (shared/testing.ts) and submits. The report is a
   RECORD against a named person: name and Mobile Money number are required, and a stable
   per-browser id groups repeat runs by the same tester even when they type their name
   differently. Nothing is deduplicated — a second run on the same platform is a second
   report, because the second run is the interesting one after a fix.
   ============================================================ */
import type { CountryCode, TestCaseResult, TestReport } from "../../../shared/types.js";
import { TEST_CASE_IDS } from "../../../shared/testing.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";

const all: TestReport[] = [];

register(
  "testReports",
  () => all,
  (d: TestReport[]) => { all.length = 0; all.push(...d); },
);

function shortRef(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return `TR-${s}`;
}

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Validate the client's results against the shared case list. Unknown ids are dropped,
 *  duplicates keep the last answer, outcomes outside the three are treated as skipped. */
export function normaliseResults(raw: unknown): TestCaseResult[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, TestCaseResult>();
  for (const r of raw) {
    const o = (r ?? {}) as { caseId?: unknown; outcome?: unknown; note?: unknown };
    const caseId = String(o.caseId ?? "");
    if (!TEST_CASE_IDS.has(caseId)) continue;
    const outcome = o.outcome === "pass" || o.outcome === "fail" ? o.outcome : "skip";
    const note = clean(o.note, 400) || undefined;
    byId.set(caseId, { caseId, outcome, ...(note ? { note } : {}) });
  }
  return [...byId.values()];
}

export function fileTestReport(input: {
  testerId: string; name: string; phone: string; country: CountryCode;
  platform: TestReport["platform"]; device?: unknown; build?: unknown; lang: "en" | "fr"; results: TestCaseResult[];
}): TestReport {
  let ref = shortRef();
  while (all.some((r) => r.ref === ref)) ref = shortRef();
  const device = clean(input.device, 120) || undefined;
  const build = clean(input.build, 60) || undefined;
  const record: TestReport = {
    id: id("treport"),
    ref,
    testerId: input.testerId,
    name: input.name,
    phone: input.phone,
    country: input.country,
    platform: input.platform,
    ...(device ? { device } : {}),
    ...(build ? { build } : {}),
    lang: input.lang,
    results: input.results,
    passed: input.results.filter((r) => r.outcome === "pass").length,
    failed: input.results.filter((r) => r.outcome === "fail").length,
    skipped: input.results.filter((r) => r.outcome === "skip").length,
    createdAt: new Date().toISOString(),
  };
  all.unshift(record);
  touch("testReports");
  return record;
}

/** Newest first. */
export function listTestReports(): TestReport[] {
  return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
