/* ============================================================
   Testing — what testers filed from momome.xyz/test, by tester.

   The operator's questions, in order: who has tested, on what, how did it go, and what
   exactly broke. So the view leads with one row per tester (latest run per platform),
   and a row opens into the run's failed cases with the tester's own words.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { TestReport } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { AKpi, Card, Grid, SectionTitle } from "../AdminUI.js";

type CaseMeta = { id: string; title: string; section: string };

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function TestingView() {
  const [data, setData] = useState<{ total: number; testers: number; items: TestReport[]; cases: CaseMeta[] } | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [platform, setPlatform] = useState<"all" | TestReport["platform"]>("all");
  const load = () => { api.adminTestReports().then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Could not load reports.")); };
  useEffect(load, []);

  const titles = useMemo(() => new Map((data?.cases ?? []).map((c) => [c.id, c.title])), [data]);
  const items = useMemo(() => (data?.items ?? []).filter((r) => platform === "all" || r.platform === platform), [data, platform]);

  // One line per tester per platform: their latest run. Earlier runs stay reachable inside.
  const byTester = useMemo(() => {
    const m = new Map<string, { name: string; phone: string; country: string; runs: TestReport[] }>();
    for (const r of items) {
      const k = r.testerId;
      const e = m.get(k) ?? { name: r.name, phone: r.phone, country: r.country, runs: [] };
      e.runs.push(r);
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].runs[0]!.createdAt.localeCompare(a[1].runs[0]!.createdAt));
  }, [items]);

  // Which cases fail most, across the latest run of every tester — the release's short list.
  const hot = useMemo(() => {
    const count = new Map<string, number>();
    for (const [, t] of byTester) for (const x of t.runs[0]!.results) if (x.outcome === "fail") count.set(x.caseId, (count.get(x.caseId) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [byTester]);

  const failed = items.reduce((n, r) => n + r.failed, 0);
  const passed = items.reduce((n, r) => n + r.passed, 0);

  return (
    <div>
      <SectionTitle t="Testing" s="Checklist runs filed from momome.xyz/test. Each run names the tester; repeat runs by the same person are grouped." />
      {err && <p role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{err}</p>}

      <Grid cols={4} style={{ marginBottom: 16 }}>
        <AKpi label="Testers" value={byTester.length} />
        <AKpi label="Runs" value={items.length} />
        <AKpi label="Cases passed" value={passed} tone="recv" />
        <AKpi label="Cases failed" value={failed} tone={failed ? "bad" : "recv"} />
      </Grid>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {(["all", "web", "android", "ios"] as const).map((p) => (
          <button key={p} type="button" className={`btn btn-sm ${platform === p ? "btn-primary" : "btn-quiet"}`} onClick={() => setPlatform(p)}>
            {p === "all" ? "All platforms" : p === "ios" ? "iOS" : p[0]!.toUpperCase() + p.slice(1)}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-quiet btn-sm" onClick={load}>Refresh</button>
      </div>

      {hot.length > 0 && (
        <Card title="Failing most" sub="Across each tester's latest run. Fix these first." style={{ marginBottom: 16 }}>
          {hot.map(([id, n]) => (
            <div key={id} style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line-2)", fontSize: 13 }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-3)", width: 24 }}>{id}</span>
              <span style={{ flex: 1 }}>{titles.get(id) ?? id}</span>
              <strong style={{ color: "var(--bad)" }}>{n} tester{n === 1 ? "" : "s"}</strong>
            </div>
          ))}
        </Card>
      )}

      <Card title="By tester" sub={byTester.length ? "Latest run first. Open a row for the failed cases in the tester's words." : "No runs yet. Send testers to momome.xyz/test."} pad={false}>
        {byTester.map(([tid, t]) => {
          const latest = t.runs[0]!;
          const isOpen = open === tid;
          return (
            <div key={tid} style={{ borderTop: "1px solid var(--line-2)" }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : tid)} aria-expanded={isOpen}
                style={{ width: "100%", textAlign: "left", background: "transparent", border: 0, cursor: "pointer", padding: "12px 20px", display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) auto auto", gap: 12, alignItems: "center", color: "var(--ink)", fontSize: 13 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)" }}>{t.country} {t.phone}</div>
                </div>
                <div style={{ minWidth: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                  <div>{latest.platform === "ios" ? "iOS" : latest.platform[0]!.toUpperCase() + latest.platform.slice(1)}{latest.build ? ` · ${latest.build}` : ""}</div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{latest.device ?? ""}</div>
                </div>
                <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--good)", fontWeight: 700 }}>{latest.passed} ✓</span>{" "}
                  <span style={{ color: latest.failed ? "var(--bad)" : "var(--ink-3)", fontWeight: 700 }}>{latest.failed} ✗</span>{" "}
                  <span style={{ color: "var(--ink-3)" }}>{latest.skipped} –</span>
                </div>
                <div style={{ color: "var(--ink-3)", fontSize: 12, whiteSpace: "nowrap" }}>{when(latest.createdAt)}{t.runs.length > 1 ? ` · ${t.runs.length} runs` : ""}</div>
              </button>
              {isOpen && t.runs.map((run) => (
                <div key={run.id} style={{ padding: "4px 20px 14px 20px", background: "var(--paper)", borderTop: "1px dashed var(--line-2)", fontSize: 13 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", margin: "8px 0 6px" }}>
                    <strong style={{ fontFamily: "var(--font-mono)" }}>{run.ref}</strong>
                    <span style={{ color: "var(--ink-3)", fontSize: 12 }}>{when(run.createdAt)} · {run.platform}{run.build ? ` ${run.build}` : ""}{run.device ? ` · ${run.device}` : ""} · {run.lang.toUpperCase()}</span>
                  </div>
                  {run.results.filter((x) => x.outcome === "fail").length === 0 && <div style={{ color: "var(--good)" }}>Nothing failed in this run.</div>}
                  {run.results.filter((x) => x.outcome === "fail").map((x) => (
                    <div key={x.caseId} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 8, padding: "5px 0" }}>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--bad)" }}>{x.caseId}</span>
                      <div><div style={{ fontWeight: 650 }}>{titles.get(x.caseId) ?? x.caseId}</div>{x.note && <div style={{ color: "var(--ink-2)" }}>“{x.note}”</div>}</div>
                    </div>
                  ))}
                  {run.results.some((x) => x.outcome === "skip") && (
                    <div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 6 }}>Skipped: {run.results.filter((x) => x.outcome === "skip").map((x) => x.caseId).join(", ")}</div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
