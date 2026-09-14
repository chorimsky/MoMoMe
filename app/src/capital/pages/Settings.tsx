/* ============================================================
   /capital-intelligence/settings — the Capital platform's own settings:
   concentration thresholds, platform/session facts, data source. Operator
   settings (rails, pricing, users) stay in the MoMo›Me console, reachable
   through one explicit button.
   ============================================================ */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ConcentrationDim } from "@shared/capital.js";
import { ROLE_ACCESS_LABEL } from "@shared/roles.js";
import { useAdminUser } from "../../pages/admin/AdminGate.js";
import { api } from "../../api/client.js";
import { capitalApi, DATA_SOURCE } from "../data/source.js";
import { useResource, useAction } from "../data/hooks.js";
import { useFilters } from "../data/filters.js";
import { can } from "../data/permissions.js";
import { titleCase } from "../lib/money.js";
import { PageHeader, Grid, Card, DataState, KV, Field, ErrorLine, Badge } from "../components/ui.js";

const DIMS: ConcentrationDim[] = ["investor", "country", "currency", "rail", "provider", "capitalType"];

export function SettingsPage() {
  const user = useAdminUser();
  const { reset } = useFilters();
  const conc = useResource(() => capitalApi.concentration({ period: "30d" }), []);
  const config = useResource(() => api.getConfig(), []);
  const [th, setTh] = useState<Record<ConcentrationDim, number> | null>(null);
  const save = useAction(() => capitalApi.setThresholds(th ?? {}), () => conc.refresh());
  const thresholds = th ?? conc.data?.thresholds ?? null;
  return (
    <div>
      <PageHeader title="Settings" sub="Settings that belong to the capital platform. Rails, pricing, users and operational controls live in the MoMo›Me console." action={can(user.role, "view:operations") && <Link to="/admin" className="cap-btn">Open MoMo›Me console ↗</Link>} />
      <Grid cols={2}>
        <Card title="Concentration thresholds" sub="Share of exposure at which a segment is CRITICAL (85% of it HIGH, 60% MEDIUM). Used by Concentration, Risk and the DIVERSIFY_CAPITAL recommendation.">
          <DataState loading={conc.loading} error={conc.error} forbidden={conc.forbidden} onRetry={conc.refresh} rows={3}>
            {thresholds && (
              <div style={{ display: "grid", gap: 10 }}>
                <Grid cols={3}>{DIMS.map((k) => <Field key={k} label={`${titleCase(k)} (%)`}><input className="cap-input" type="number" min={1} max={100} disabled={!can(user.role, "thresholds:set")} value={thresholds[k]} onChange={(e) => setTh({ ...thresholds, [k]: Number(e.target.value) })} /></Field>)}</Grid>
                {can(user.role, "thresholds:set") ? <div><button type="button" className="cap-btn primary" disabled={save.busy || !th} onClick={() => save.run()}>Save thresholds</button></div> : <span className="cap-sub">Your role can view thresholds but not change them.</span>}
                <ErrorLine error={save.error} />
              </div>
            )}
          </DataState>
        </Card>
        <Card title="Platform">
          <KV k="Signed in as" v={`${user.username} · ${user.role}`} />
          <KV k="Access" v={ROLE_ACCESS_LABEL[user.role]} />
          <KV k="Environment" v={config.data ? <Badge tone={config.data.demoMode ? "warn" : "good"}>{config.data.demoMode ? "Sandbox" : "Live"}</Badge> : "—"} />
          <KV k="Data source" v={<Badge tone={DATA_SOURCE === "mock" ? "warn" : "good"}>{DATA_SOURCE === "mock" ? "MOCK — fictional fixtures" : "API — live backend"}</Badge>} />
          <KV k="Capital API" v={<span className="mono" style={{ fontSize: 12 }}>/api/capital/*</span>} />
          <KV k="Session" v="Shared with the MoMo›Me console (same login); expires with the tab." />
          <div className="cap-toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="cap-btn" onClick={reset}>Reset global filters</button>
            <button type="button" className="cap-btn" onClick={() => { try { localStorage.removeItem("mm_capital_nav"); sessionStorage.removeItem("mm_capital_copilot_thread"); } catch { /* blocked */ } window.location.reload(); }}>Clear local preferences</button>
          </div>
        </Card>
      </Grid>
    </div>
  );
}
