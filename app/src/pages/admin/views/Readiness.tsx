/* ============================================================
   Go-live readiness — Super Admin only.
   One page answering "what is stopping this from going live, and what exactly do I set?".
   Every value comes from GET /admin/readiness, which derives it from the same functions
   the boot gates and the money path use, so it cannot drift from a written checklist.
   Presence and shape only — never a secret value.
   ============================================================ */
import { useEffect, useState } from "react";
import { Card, Field, Grid, Pill, SectionTitle } from "../AdminUI.js";
import { api } from "../../../api/client.js";
import type { Readiness, ReadinessCheck, ReadinessRail } from "../../../api/client.js";

const tone = (s: ReadinessCheck["state"]) => (s === "ok" ? "recv" : s === "warn" ? "warn" : "bad");
const label = (s: ReadinessCheck["state"]) => (s === "ok" ? "OK" : s === "warn" ? "Not set" : "Blocked");

function CheckRow({ c }: { c: ReadinessCheck }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.label}</div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2, wordBreak: "break-word" }}>{c.detail}</div>
        {/* The fix line is the point of the page: a red pill that does not say what to do
            is just anxiety. Only shown when something is actually wrong. */}
        {c.fix && c.state !== "ok" && (
          <div style={{ fontSize: 12, color: "var(--warn-ink)", marginTop: 4 }}>{c.fix}</div>
        )}
      </div>
      <Pill status={label(c.state)} tone={tone(c.state)} />
    </div>
  );
}

function RailRow({ r }: { r: ReadinessRail }) {
  const status = !r.configured ? "Not configured" : r.live ? "Production" : "Sandbox";
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
          {r.name}
          {r.routes === false && <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 8 }}>· out of rotation</span>}
        </div>
        <Pill status={status} tone={r.live ? "warn" : r.configured ? "recv" : undefined} />
      </div>
      {r.missing.length > 0 && (
        <div className="mono" style={{ fontSize: 11.5, color: "var(--warn-ink)", marginTop: 4 }}>
          missing: {r.missing.join(", ")}
        </div>
      )}
      {r.reachability && !r.reachability.ok && (
        <div style={{ fontSize: 12, color: "var(--warn-ink)", marginTop: 4 }}>{r.reachability.reason}</div>
      )}
    </div>
  );
}

export function ReadinessView() {
  const [d, setD] = useState<Readiness | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminReadiness()
      .then((r) => { if (alive) setD(r); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Could not load readiness."); });
    return () => { alive = false; };
  }, []);

  const blocked = [...(d?.gates ?? []), ...(d?.secrets ?? [])].filter((c) => c.state === "blocked").length;

  return (
    <div>
      <SectionTitle t="Go-live readiness" s="What is stopping real money from flowing, and exactly what to set." />
      {err && <div className="card" style={{ padding: 16, color: "var(--warn-ink)" }}>{err}</div>}

      {d && (
        <>
          <Card
            title={d.liveMoney ? "LIVE — real money can move" : "Sandbox — nothing real moves"}
            action={<Pill status={d.liveMoney ? "Live" : "Sandbox"} tone={d.liveMoney ? "warn" : "recv"} />}
            style={{ marginBottom: 16 }}
          >
            <Grid cols={2} gap={12}>
              <Field label="Deploy environment" value={d.deployEnv} mono />
              <Field label="Blocking issues" value={blocked === 0 ? "none" : String(blocked)} mono />
            </Grid>
          </Card>

          <Grid cols={2} gap={16}>
            <Card title="Boot gates">
              {d.gates.map((c) => <CheckRow key={c.label} c={c} />)}
            </Card>
            <Card title="Secrets">
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
                Presence only — values are never sent to this page.
              </div>
              {d.secrets.map((c) => <CheckRow key={c.label} c={c} />)}
            </Card>
            <Card title="Crypto inbound rails">
              {d.rails.crypto.map((r) => <RailRow key={r.name} r={r} />)}
            </Card>
            <Card title="Mobile Money payout rails">
              {d.rails.payout.map((r) => <RailRow key={r.name} r={r} />)}
            </Card>
          </Grid>

          <Card title="Egress IP allowlist" style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>{d.egress.note}</div>
            <Grid cols={2} gap={12} style={{ marginTop: 10 }}>
              <Field label="Outbound IP" value={d.egress.ip ?? "unknown"} mono />
              <Field label="Registered" value={d.egress.expected ?? "—"} mono />
            </Grid>
          </Card>
        </>
      )}
    </div>
  );
}
