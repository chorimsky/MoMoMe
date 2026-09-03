/* ============================================================
   Payments — every Mobile Money payment, from api.adminPayments().
   Row → drawer showing the double-entry ledger (api.ledger).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { LedgerEntry, Method, Payment, UnattributedInbound } from "@shared/types.js";
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
  const head = ["Reference", "Recipient", "Phone", "Country", "Provider", "Amount XAF", "Fee XAF", "Rail", "Status", "Created", "Origin country", "Origin city", "Origin IP"];
  // Neutralize CSV formula injection on any free-text cell (matches the server export guard).
  const esc = (v: string | number) => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const lines = rows.map((p) => [p.ref, p.recipient.name, p.recipient.phone, p.recipient.country, p.recipient.provider, p.xaf, p.feeXaf, p.method, p.displayStatus, p.createdAt, p.senderLocation?.country ?? "", p.senderLocation?.city ?? "", p.senderLocation?.ip ?? ""].map(esc).join(","));
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

/** Emoji flag from an ISO-3166 alpha-2 code (works for any country, not just CEMAC). */
function ccFlag(cc?: string): string {
  if (!cc || !/^[a-zA-Z]{2}$/.test(cc)) return "🌍";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
/** One-line "where the payment came from", or null if the origin is unknown. */
function originLine(p: Payment): string | null {
  const l = p.senderLocation;
  if (!l) return null;
  return [l.city, l.countryCode].filter(Boolean).join(", ") || l.country || l.countryCode || null;
}

export function PaymentsView() {
  const { query } = useAdmin();
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("All");
  const [sel, setSel] = useState<Payment | null>(null);

  // Receipts with no payment to attach them to. They belong HERE — the transaction list is
  // where an operator looks to see everything that came in, and money nobody can account
  // for is the entry that most needs looking at.
  const [unattributed, setUnattributed] = useState<UnattributedInbound[]>([]);

  useEffect(() => {
    let alive = true;
    api.adminPayments()
      .then((p) => { if (alive) setRows(p); })
      .catch(() => { if (alive) setErr("Couldn't load payments."); });
    api.adminUnattributed()
      .then((u) => { if (alive) setUnattributed(u.items.filter((r) => !r.resolvedAt)); })
      .catch(() => { /* the payments list is the primary view; don't fail it over this */ });
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

      {/* Money that arrived with nothing to attach it to. Held as a liability, and shown
          FIRST because someone has paid and is waiting — this is the entry in the
          transaction list that most needs a person. */}
      {unattributed.length > 0 && (
        <Card pad={false}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 13.5 }}>
              {unattributed.length} unattributed receipt{unattributed.length === 1 ? "" : "s"}
            </strong>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>
              Crypto arrived with no payment to attach it to. It is held as a liability — attribute or refund it.
            </div>
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {unattributed.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", padding: "11px 20px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>{r.amount} {r.asset === "UNKNOWN_STABLECOIN" ? "(asset unknown)" : r.asset}</strong>
                <RailBadge rail={r.rail} />
                <span style={{ color: "var(--ink-3)", fontFamily: "var(--mono, monospace)", fontSize: 11.5, wordBreak: "break-all" }}>{r.providerRef}</span>
                <div style={{ flex: 1 }} />
                <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                  {new Date(r.firstSeenAt).toLocaleString()}{r.seenCount > 1 ? ` · seen ${r.seenCount}×` : ""}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mm-toolbar" style={{ marginBottom: 14, marginTop: unattributed.length > 0 ? 14 : 0 }}>
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
                  <RailBadge rail={p.method} provider={p.payInstruction?.provider} />
                  <Pill status={p.displayStatus} />
                  <span style={{ minWidth: 0 }}>
                    <span className="num" style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtDate(p.createdAt)}</span>
                    {originLine(p) && (
                      <span title="Payment origin" style={{ display: "block", fontSize: 10, color: "var(--ink-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ccFlag(p.senderLocation?.countryCode)} {originLine(p)}</span>
                    )}
                  </span>
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
          <Block title="Sent from">
            {p.senderLocation ? (
              <>
                <KV k="Origin" v={`${ccFlag(p.senderLocation.countryCode)} ${p.senderLocation.country ?? p.senderLocation.countryCode ?? "—"}`} />
                {(p.senderLocation.city || p.senderLocation.region) && <KV k="City / region" v={[p.senderLocation.city, p.senderLocation.region].filter(Boolean).join(", ")} />}
                {p.senderLocation.ip && <KV k="IP address" v={p.senderLocation.ip} />}
                <KV k="Source" v={p.senderLocation.source === "header" ? "Edge geo header" : "IP lookup"} />
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
                {p.source === "lnurl" ? "Paid via an external Lightning wallet — no app origin." : "Origin not available for this payment."}
              </div>
            )}
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
