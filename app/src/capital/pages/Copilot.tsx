/* ============================================================
   /ai-copilot — Ask (natural-language front on the structured engine),
   /insights, /recommendations (shared centre), /audit.
   Every answer shows metrics, assumptions, sources, calculations, confidence
   and data freshness. The copilot never executes; it can only point at a
   recommendation that still needs a person to review and a second to approve.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CopilotAnswer, CopilotAuditEntry } from "@shared/capital.js";
import { capitalApi } from "../data/source.js";
import { useResource, useAction, ago } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { money, dateTime } from "../lib/money.js";
import { PageHeader, Card, DataState, DataTable, ConfidenceBadge, SourceTrace, CalculationTrace, Badge, Tabs, ErrorLine, type Column } from "../components/ui.js";

const TABS = [{ to: "", label: "Ask", end: true }, { to: "/insights", label: "Insights" }, { to: "/recommendations", label: "Recommendations" }, { to: "/audit", label: "AI Audit" }];
const KEY = "mm_capital_copilot_thread";
type Turn = { q: string; a?: CopilotAnswer; error?: string };

export function AskPage() {
  const { intel } = useFilters();
  const ex = useResource(() => capitalApi.copilotExamples(), []);
  const [thread, setThread] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as Turn[]; } catch { return []; } });
  const [q, setQ] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(thread.slice(-20))); } catch { /* blocked */ } endRef.current?.scrollIntoView({ block: "end" }); }, [thread]);
  const ask = useAction(async (question: string) => { setThread((t) => [...t, { q: question }]); const a = await capitalApi.ask(question, intel); setThread((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x))); return a; });
  const submit = (question: string) => { const s = question.trim(); if (s.length < 3 || ask.busy) return; setQ(""); ask.run(s).then((r) => { if (!r) setThread((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: "The engine could not answer." } : x))); }); };
  return (
    <div>
      <PageHeader title="AI Capital Copilot" sub="Ask in plain language. Every answer is computed by the intelligence engine from verified data; the copilot explains, it never invents a number and never acts on its own." action={<button type="button" className="cap-btn" onClick={() => setThread([])}>Clear</button>} />
      <Tabs items={TABS} base="/ai-copilot" />
      <div className="cap-split">
        <div style={{ display: "grid", gap: 12 }}>
          <Card>
            <div className="cap-chat" aria-live="polite">
              {thread.length === 0 && <div className="cap-state">Ask about liquidity needs, the biggest risk, which investors to contact, a volume scenario, route efficiency, idle capital, requirement priority, revenue, forecasts or the capital position.</div>}
              {thread.map((t, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <div className="cap-msg user"><b>You</b><div>{t.q}</div></div>
                  {t.a ? <AnswerCard a={t.a} /> : t.error ? <div className="cap-msg ai" role="alert">{t.error}</div> : <div className="cap-msg ai" aria-busy="true"><div className="cap-skel" style={{ height: 16, width: "60%" }} /><div className="cap-skel" style={{ height: 16, width: "85%", marginTop: 6 }} /></div>}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submit(q); }} style={{ display: "flex", gap: 8, marginTop: 14 }}><input className="cap-input" aria-label="Your question" placeholder="e.g. How much liquidity do we need over the next 90 days?" value={q} onChange={(e) => setQ(e.target.value)} /><button type="submit" className="cap-btn primary" disabled={ask.busy || q.trim().length < 3}>{ask.busy ? "Thinking…" : "Ask"}</button></form>
            <ErrorLine error={ask.error} />
          </Card>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <Card title="Example questions"><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{(ex.data?.questions ?? []).map((s) => <button key={s} type="button" className="cap-chip" onClick={() => submit(s)}>{s}</button>)}</div></Card>
          <Card title="How this works"><ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, display: "grid", gap: 4 }}><li>Your question is classified to an intent.</li><li>The engine computes the answer from verified data (payments, ledger, float, capital ledgers).</li><li>The explanation is phrased from those numbers only — a language model, when configured, may reword it but cannot add figures.</li><li>Sources, calculation, confidence and freshness are attached.</li><li>Any action goes to Recommendations for human review and a second person's approval.</li></ol></Card>
        </div>
      </div>
    </div>
  );
}
function AnswerCard({ a }: { a: CopilotAnswer }) {
  return (
    <div className="cap-msg ai">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}><b>Copilot</b><ConfidenceBadge level={a.confidence} /><Badge>{a.explainedBy === "engine+llm" ? "engine + model wording" : "engine"}</Badge><span className="cap-sub">Data updated {ago(a.dataUpdatedAt)} · {dateTime(a.at)}</span></div>
      <p style={{ fontSize: 14 }}>{a.answer}</p>
      {a.metrics.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{a.metrics.map((m) => <span key={m.label} className="cap-badge" data-tone="ink" style={{ fontSize: 12 }}>{m.label}: <b className="num" style={{ marginLeft: 4 }}>{typeof m.value === "number" ? (m.ccy ? money(m.value, m.ccy) : m.value) : m.value}</b></span>)}</div>}
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {a.assumptions.length > 0 && <details className="cap-trace"><summary><span>Assumptions ({a.assumptions.length})</span><span>▾</span></summary><div><ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{a.assumptions.map((s) => <li key={s}>{s}</li>)}</ul></div></details>}
        <SourceTrace sources={a.sources} compact />
        {a.calculations.map((c) => <CalculationTrace key={c.id} calc={c} />)}
        {a.suggestedActions.length > 0 && <div><div className="overline" style={{ marginBottom: 4 }}>Suggested actions — require human review and approval</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{a.suggestedActions.map((s, i) => (s.recommendationId ? <Link key={i} to={`/ai-copilot/recommendations/${s.recommendationId}`} className="cap-btn sm">{s.label}</Link> : <span key={i} className="cap-badge">{s.label}</span>))}</div></div>}
      </div>
    </div>
  );
}

export function InsightsPage() {
  const { intel } = useFilters();
  const r = useResource(() => capitalApi.insights(intel), [JSON.stringify(intel)]);
  return (
    <div>
      <PageHeader title="Insights" sub="What the engine noticed in the current period — each with its sources." />
      <Tabs items={TABS} base="/ai-copilot" />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={4} empty={(r.data?.insights.length ?? 0) === 0} emptyHint="No insights for the period.">
        <div style={{ display: "grid", gap: 10 }}>{(r.data?.insights ?? []).map((i) => <Card key={i.id} title={<span><Badge tone={i.tone}>{i.tone}</Badge> {i.title}</span>}><p style={{ fontSize: 13.5 }}>{i.text}</p><div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}><SourceTrace sources={i.sources} compact />{i.recommendationId && <Link to={`/ai-copilot/recommendations/${i.recommendationId}`} className="cap-btn sm">Recommendation</Link>}</div></Card>)}</div>
      </DataState>
    </div>
  );
}

export function AiAuditPage() {
  const r = useResource(() => capitalApi.copilotAudit(), []);
  const [open, setOpen] = useState<CopilotAuditEntry | null>(null);
  const cols: Column<CopilotAuditEntry>[] = [
    { key: "at", label: "When", render: (e) => dateTime(e.at), sort: (e) => e.at },
    { key: "user", label: "User", render: (e) => e.user, sort: (e) => e.user },
    { key: "q", label: "Question", render: (e) => <div><b>{e.question}</b><div className="cap-sub">intent {e.intent}</div></div> },
    { key: "src", label: "Sources", render: (e) => e.sources.length },
    { key: "conf", label: "Confidence", render: (e) => <ConfidenceBadge level={e.confidence} /> },
    { key: "act", label: "Actions", render: (e) => <span className="cap-sub">req {e.requestedActions.length} · appr {e.approvedActions.length} · exec {e.executedActions.length}</span> },
  ];
  return (
    <div>
      <PageHeader title="AI Audit" sub="Every copilot exchange: who asked what, when, which data was used, what the engine returned, what was answered, and which actions were requested, approved and executed." />
      <Tabs items={TABS} base="/ai-copilot" />
      <DataState loading={r.loading} error={r.error} forbidden={r.forbidden} onRetry={r.refresh} rows={5} empty={(r.data?.entries.length ?? 0) === 0} emptyHint="No copilot activity recorded yet.">
        <div className="cap-split">
          <Card pad={false}><DataTable rows={r.data?.entries ?? []} columns={cols} rowKey={(e) => e.id} onRow={setOpen} selectedKey={open?.id} stack={false} initialSort={{ key: "at", dir: "desc" }} /></Card>
          <Card title={open ? `Entry ${open.id}` : "Select an entry"}>{open ? <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}><div><div className="overline">Answer</div><p>{open.answer}</p></div><SourceTrace sources={open.sources} /><details className="cap-trace"><summary><span>Engine result</span><span>▾</span></summary><div><pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, fontFamily: "var(--font-mono)" }}>{JSON.stringify(open.engineResult, null, 2)}</pre></div></details><div><div className="overline">Requested actions</div>{open.requestedActions.length ? open.requestedActions.map((a) => <div key={a}><Link to={`/ai-copilot/recommendations/${a}`}>{a}</Link></div>) : <span className="cap-sub">none</span>}</div><div><div className="overline">Approved</div>{open.approvedActions.join(", ") || <span className="cap-sub">none</span>}</div><div><div className="overline">Executed</div>{open.executedActions.join(", ") || <span className="cap-sub">none</span>}</div></div> : <span className="cap-sub">Click a row to inspect it.</span>}</Card>
        </div>
      </DataState>
    </div>
  );
}
