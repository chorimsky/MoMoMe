/* ============================================================
   Payments — every Mobile Money payment, from api.adminPayments().
   Row → drawer showing the double-entry ledger (api.ledger).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { LedgerEntry, Method, Payment } from "@shared/types.js";
import { METHOD_META } from "@shared/domain.js";
import { canMovePaymentFunds } from "@shared/roles.js";
import { api } from "../../../api/client.js";
import { Flag, RailBadge } from "../../../components/atoms.js";
import { fmt } from "../../../lib/format.js";
import { Card, KV, Pill, SectionTitle, SegToggle } from "../AdminUI.js";
import { useAdmin } from "../context.js";
import { useAdminUser } from "../AdminGate.js";
import { Failed, Loading } from "./Overview.js";

function exportCsv(rows: Payment[]) {
  const head = ["Reference", "Recipient", "Phone", "Country", "Provider", "Amount XAF", "Fee XAF", "Rail", "Status", "Created"];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((p) => [p.ref, p.recipient.name, p.recipient.phone, p.recipient.country, p.recipient.provider, p.xaf, p.feeXaf, p.method, p.displayStatus, p.createdAt].map(esc).join(","));
  const csv = [head.map(esc).join(","), ...lines].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `momome-payments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const COLS = "1fr 1.7fr 0.9fr 1.1fr 0.9fr 0.9fr 0.5fr";
const FILTERS = ["All", "Completed", "Pending", "Failed"] as const;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function PaymentsView() {
  const { query } = useAdmin();
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("All");
  const [sel, setSel] = useState<Payment | null>(null);

  useEffect(() => {
    let alive = true;
    api.adminPayments()
      .then((p) => { if (alive) setRows(p); })
      .catch(() => { if (alive) setErr("Couldn't load payments."); });
    return () => { alive = false; };
  }, []);

  const reload = async () => { setRows(await api.adminPayments()); };

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (rows ?? []).filter((p) => {
      if (status !== "All" && p.displayStatus !== status) return false;
      if (!q) return true;
      return [p.ref, p.recipient.name, p.recipient.phone, p.recipient.provider].some((f) => f.toLowerCase().includes(q));
    }),
    [rows, status, q],
  );

  if (err) return <Failed t="Payments" msg={err} />;
  if (!rows) return <Loading t="Payments" s="Every Mobile Money payment that moves through the platform." />;

  return (
    <div>
      <SectionTitle t="Payments" s="Every Mobile Money payment that moves through the platform." />
      <div className="mm-toolbar" style={{ marginBottom: 14 }}>
        <SegToggle options={[...FILTERS]} value={status} onChange={setStatus} />
        {q && <span className="pill" style={{ fontSize: 11.5 }}>“{query}” · {filtered.length}</span>}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" disabled={filtered.length === 0} onClick={() => exportCsv(filtered)} style={{ padding: "9px 14px", fontSize: 13 }}>↓ Export CSV</button>
      </div>
      <Card pad={false}>
        <div className="mm-tablewrap">
          <div className="mm-table">
            <div style={{ display: "grid", gridTemplateColumns: COLS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700, color: "var(--ink-3)", padding: "14px 20px 10px", borderBottom: "1px solid var(--line)" }}>
              <span>Reference</span><span>Recipient</span><span>Amount</span><span>Rail</span><span>Status</span><span>Date</span><span></span>
            </div>
            <div style={{ maxHeight: 540, overflowY: "auto" }}>
              {filtered.length === 0 && <div style={{ padding: "18px 20px", fontSize: 13, color: "var(--ink-3)" }}>No payments match this view.</div>}
              {filtered.map((p) => (
                <button key={p.id} type="button" onClick={() => setSel(p)}
                  style={{ display: "grid", gridTemplateColumns: COLS, gap: 0, alignItems: "center", padding: "12px 20px", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--line-2)", font: "inherit", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600 }}>{p.ref}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <Flag country={p.recipient.country} size={14} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.recipient.name}</span>
                      <span className="num" style={{ fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{p.recipient.phone}</span>
                    </span>
                  </span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{fmt(p.xaf)} XAF</span>
                  <RailBadge rail={p.method} />
                  <Pill status={p.displayStatus} />
                  <span className="num" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{fmtDate(p.createdAt)}</span>
                  <span style={{ textAlign: "right", fontSize: 12, fontWeight: 650, color: "var(--accent)" }}>View</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
      {sel && <PaymentDrawer p={sel} onClose={() => setSel(null)} onChanged={async () => { await reload(); setSel(null); }} />}
    </div>
  );
}

/* ---------- payment detail drawer ---------- */
function PaymentDrawer({ p, onClose, onChanged }: { p: Payment; onClose: () => void; onChanged: () => Promise<void> }) {
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [ledgerErr, setLedgerErr] = useState(false);
  const [busy, setBusy] = useState<"" | "retry" | "refund">("");
  const [actErr, setActErr] = useState<string | null>(null);
  const { role } = useAdminUser();
  const canMoveFunds = canMovePaymentFunds(role);
  const method = METHOD_META[p.method as Method];

  const act = async (kind: "retry" | "refund") => {
    setBusy(kind); setActErr(null);
    try {
      const r = kind === "retry" ? await api.retryPayment(p.id) : await api.refundPayment(p.id);
      if (!r.ok) {
        setActErr(kind === "retry" ? "Retry didn't go through — no funded rail, or it's already completed." : "Refund couldn't be applied to this payment.");
        setBusy(""); return;
      }
      await onChanged();
    } catch (e) {
      setActErr(e instanceof Error ? e.message : "Action failed. Please try again.");
      setBusy("");
    }
  };

  useEffect(() => {
    let alive = true;
    api.ledger(p.id)
      .then((l) => { if (alive) setLedger(l); })
      .catch(() => { if (alive) setLedgerErr(true); });
    return () => { alive = false; };
  }, [p.id]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, background: "oklch(0.2 0.01 64 / 0.42)", border: "none", cursor: "pointer" }} />
      <div role="dialog" aria-label={`Payment ${p.ref}`} style={{ position: "absolute", top: 0, right: 0, height: "100vh", width: "min(440px, 92vw)", background: "var(--surface)", borderLeft: "1px solid var(--line)", boxShadow: "var(--shadow-pop)", overflowY: "auto", animation: "slideL .25s ease" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="num" style={{ fontSize: 16, fontWeight: 750 }}>{p.ref}</div>
              <div style={{ marginTop: 4 }}><Pill status={p.displayStatus} /></div>
            </div>
            <button type="button" onClick={onClose} className="btn btn-quiet" style={{ padding: "5px 10px", fontSize: 16 }}>✕</button>
          </div>
        </div>
        <div style={{ padding: "8px 22px 24px" }}>
          <Block title="Recipient">
            <KV k="Name" v={p.recipient.name} />
            <KV k="Phone" v={p.recipient.phone} />
            <KV k="Provider" v={p.recipient.provider} />
            <KV k="Name source" v={p.recipient.nameSource} />
          </Block>
          <Block title="Amounts">
            <KV k="Delivered" v={`${fmt(p.xaf)} XAF`} tone="recv" />
            <KV k="Fee" v={`${fmt(p.feeXaf)} XAF`} />
            <KV k="Total" v={`${fmt(p.totalXaf)} XAF`} />
            <KV k="Inbound rail" v={method?.name ?? p.method} />
          </Block>
          <Block title="Ledger">
            {ledgerErr && <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Ledger unavailable.</div>}
            {!ledgerErr && !ledger && <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Loading ledger…</div>}
            {ledger?.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>No ledger entries.</div>}
            {ledger?.map((e) => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line-2)" }}>
                <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  <span className="mono" style={{ fontSize: 11, color: e.direction === "debit" ? "var(--bad)" : "var(--recv)", fontWeight: 700 }}>{e.direction === "debit" ? "DR" : "CR"}</span> {e.account}
                </span>
                <span className="num" style={{ fontSize: 12.5, fontWeight: 650, whiteSpace: "nowrap" }}>{fmt(e.amount, e.currency === "XAF" ? 0 : 2)} {e.currency}</span>
              </div>
            ))}
          </Block>

          {p.displayStatus !== "Completed" && (
            <Block title="Actions">
              {canMoveFunds ? (
                <>
                  <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 10, lineHeight: 1.45 }}>This payment hasn't been delivered. Retry the Mobile Money payout, or refund the sender.</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => act("retry")} style={{ flex: 1 }}>{busy === "retry" ? "Retrying…" : "Retry payout"}</button>
                    <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => act("refund")} style={{ flex: 1 }}>{busy === "refund" ? "Refunding…" : "Refund"}</button>
                  </div>
                  {actErr && <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--bad)", marginTop: 10, lineHeight: 1.45 }}>{actErr}</div>}
                </>
              ) : (
                <p style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 }}>This payment hasn't been delivered. Retrying the payout or refunding the sender requires an Operations Manager or Super Admin.</p>
              )}
            </Block>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "var(--ink-3)", marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}
