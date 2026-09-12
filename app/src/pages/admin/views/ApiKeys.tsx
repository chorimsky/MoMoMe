/* ============================================================
   Developers — issue and manage partner API keys (Super-Admin only).
   The plaintext secret is shown exactly ONCE at creation; only a hash is stored.
   ============================================================ */
import { useEffect, useState } from "react";
import type { ApiKey, ApiKeyUsage } from "@shared/types.js";
import { api } from "../../../api/client.js";
import { Card, SectionTitle } from "../AdminUI.js";
import { Failed, Loading } from "./Overview.js";

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ApiKeysView() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null); // shown once
  const [copied, setCopied] = useState(false);

  const load = () => api.adminApiKeys().then((r) => setKeys(r.keys)).catch(() => setErr("Couldn't load API keys."));
  useEffect(() => { void load(); }, []);

  async function create() {
    setBusy(true); setErr(null); setSecret(null);
    try {
      const r = await api.adminCreateApiKey(label.trim() || "Untitled key");
      setSecret(r.secret);
      setLabel("");
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't create the key."); }
    finally { setBusy(false); }
  }
  const [usage, setUsage] = useState<ApiKeyUsage[]>([]);
  useEffect(() => { api.adminApiKeyUsage().then((u) => setUsage(u.usage)).catch(() => {}); }, [keys?.length]);
  async function revoke(id: string) {
    if (!window.confirm("Revoke this key? Any integration using it stops working immediately.")) return;
    try { await api.adminRevokeApiKey(id); await load(); } catch { setErr("Couldn't revoke the key."); }
  }

  if (err && !keys) return <Failed t="Developers" msg={err} />;
  if (!keys) return <Loading t="Developers" s="Issue and manage partner API keys." />;

  return (
    <div>
      <SectionTitle t="Developers" s="Issue and manage API keys for partners integrating the settlement API." />

      {secret && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Your new API key — copy it now</div>
          <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "5px 0 12px", lineHeight: 1.5 }}>
            This secret is shown <b>only once</b> and can't be recovered. Store it somewhere safe; if you lose it, revoke the key and create a new one.
          </p>
          <div className="num" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "var(--r)", background: "var(--surface-2)", border: "1px dashed var(--accent)", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 0, wordBreak: "break-all", fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{secret}</span>
            <button type="button" className="btn btn-ghost" style={{ padding: "7px 12px", fontSize: 12.5 }}
              onClick={() => { void navigator.clipboard?.writeText(secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <button type="button" className="btn btn-quiet" style={{ marginTop: 10, fontSize: 12.5 }} onClick={() => setSecret(null)}>I've saved it</button>
        </Card>
      )}

      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Create a key</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Acme Payroll — production)" maxLength={80}
            style={{ flex: "1 1 240px", minWidth: 0, padding: "11px 13px", borderRadius: "var(--r)", border: "1px solid var(--line)", background: "var(--surface)", font: "inherit", fontSize: 14, color: "var(--ink)", outline: "none" }} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={create} style={{ padding: "11px 18px" }}>{busy ? "Creating…" : "Generate key"}</button>
        </div>
        {err && <div role="alert" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "var(--bad)" }}>{err}</div>}
      </Card>

      <Card pad={false}>
        <div className="mm-tablewrap">
          <div className="mm-table" data-cols="5" style={{ minWidth: 640 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 1fr 1fr 1fr 1.3fr 0.7fr", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
              <span>Label</span><span>Key</span><span>Created</span><span>Last used</span><span>Partner fee</span><span>This month</span><span></span>
            </div>
            {keys.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No API keys yet. Create one above to let a partner integrate.</div>}
            {keys.map((k) => (
              <div key={k.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 1fr 1fr 1fr 1.3fr 0.7fr", alignItems: "center", gap: 8, padding: "12px 20px", borderBottom: "1px solid var(--line-2)", opacity: k.revokedAt ? 0.55 : 1 }}>
                <span style={{ fontSize: 13, fontWeight: 650, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {k.label}
                  {k.revokedAt && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: "var(--bad)" }}>REVOKED</span>}
                </span>
                <span className="num" style={{ fontSize: 12, color: "var(--ink-2)" }}>{k.prefix}…</span>
                <span className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{fmtDate(k.createdAt)}</span>
                <span className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{fmtDate(k.lastUsedAt)}</span>
                {/* Partner pricing: this key's rate instead of the public fee; blank = public. */}
                <FeeInput value={k.feePct} onSave={async (v) => { await api.adminSetApiKeyFee(k.id, v); await load(); }} />
                <span className="num" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{(() => { const u = usage.find((x) => x.keyId === k.id); return u ? `${u.delivered}/${u.payments} · ${new Intl.NumberFormat("fr-FR").format(u.volumeXaf)} XAF · fees ${new Intl.NumberFormat("fr-FR").format(u.feeXaf)}` : "—"; })()}</span>
                <span style={{ textAlign: "right" }}>
                  {!k.revokedAt && <button type="button" className="btn btn-quiet" style={{ padding: "5px 10px", fontSize: 12, color: "var(--bad)" }} onClick={() => revoke(k.id)}>Revoke</button>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

/** A percentage box that saves on blur/Enter. Empty = the public fee. */
function FeeInput({ value, onSave }: { value?: number; onSave: (v: number | null) => Promise<void> }) {
  const [v, setV] = useState(value == null ? "" : String(+(value * 100).toFixed(2)));
  useEffect(() => { setV(value == null ? "" : String(+(value * 100).toFixed(2))); }, [value]);
  const commit = () => { const n = v.trim() === "" ? null : Number(v) / 100; if (n === null || (Number.isFinite(n) && n >= 0 && n <= 0.2)) void onSave(n); };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input className="input num" value={v} placeholder="public" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} style={{ width: 64, padding: "4px 6px", fontSize: 12 }} />
      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>%</span>
    </span>
  );
}
