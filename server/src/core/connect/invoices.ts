/* ============================================================
   MoMo›Me Connect — Invoices, payment links and request-to-pay (§27, §28, §34).
   An invoice is a first-class object that OWNS one Payment Intent; the hosted checkout URL
   and QR are that intent's. Partial payments are NOT supported: an invoice is paid in full
   once, and the intent's amount is the invoice amount (enforced here, not left implicit).
   A request-to-pay is an invoice whose payer is known (an MPI or a counterparty) and who
   is notified.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { createIntent, getIntent, checkoutUrl, type PaymentIntent } from "./intents.js";
import { getMpi, type Mpi, type PaymentMethodId } from "./identities.js";
import { getCounterparty } from "./counterparties.js";
import { enqueueEvent } from "../interop/outbound.js";

export type InvoiceStatus = "draft" | "issued" | "pending" | "paid" | "expired" | "cancelled" | "refunded";
export interface Invoice {
  id: string; orgId: string; env: "live" | "test"; kind: "invoice" | "payment_link" | "request_to_pay" | "qr";
  payee: string; payer?: { mpi?: string; counterparty?: string; name?: string; phone?: string; email?: string };
  amount: { value: number; currency: string }; description?: string; reference?: string; dueDate?: string;
  intentId: string; acceptedMethods: PaymentMethodId[]; status: InvoiceStatus; metadata: Record<string, string>;
  createdAt: string; updatedAt: string; issuedAt?: string; paidAt?: string; number: string;
}
const rows = new Map<string, Invoice>();
const byIntent = new Map<string, string>();
let seq = 1000;
register("connect_invoices", () => ({ rows: [...rows.values()].slice(-20_000), seq }), (d: { rows?: Invoice[]; seq?: number }) => { for (const r of d?.rows ?? []) { rows.set(r.id, r); byIntent.set(r.intentId, r.id); } if (d?.seq) seq = d.seq; });
const now = () => new Date().toISOString();

export interface CreateInvoiceInput { orgId: string; env: "live" | "test"; kind: Invoice["kind"]; payee: Mpi; amountXaf: number; description?: string; reference?: string; dueDate?: string; payer?: Invoice["payer"]; acceptedMethods?: PaymentMethodId[]; metadata?: Record<string, string>; callbackUrl?: string; issue?: boolean }
export function createInvoice(input: CreateInvoiceInput): Invoice {
  if (input.payer?.counterparty) { const cp = getCounterparty(input.payer.counterparty); if (!cp || cp.orgId !== input.orgId) throw new Error("counterparty_not_found"); if (cp.linkedMpi && !input.payer.mpi) input.payer.mpi = cp.linkedMpi; if (!input.payer.name) input.payer.name = cp.name; }
  const ttl = input.dueDate ? Math.max(3_600_000, Date.parse(`${input.dueDate}T23:59:59Z`) - Date.now()) : 7 * 86_400_000;
  const intent = createIntent({ orgId: input.orgId, env: input.env, surface: input.kind === "qr" ? "qr" : input.kind === "payment_link" ? "payment_link" : input.kind === "request_to_pay" ? "request_to_pay" : "invoice", payee: input.payee, payer: input.payer ? { mpi: input.payer.mpi, counterparty: input.payer.counterparty, name: input.payer.name, phone: input.payer.phone } : undefined, amountXaf: input.amountXaf, purpose: { type: input.kind === "request_to_pay" ? "request" : "invoice", reference: input.reference, description: input.description }, permittedMethods: input.acceptedMethods, ttlMs: ttl, metadata: input.metadata, callbackUrl: input.callbackUrl });
  const inv: Invoice = { id: `inv_${crypto.randomBytes(8).toString("hex")}`, orgId: input.orgId, env: input.env, kind: input.kind, payee: input.payee.id, payer: input.payer, amount: { value: Math.round(input.amountXaf), currency: "XAF" }, description: input.description, reference: input.reference, dueDate: input.dueDate, intentId: intent.id, acceptedMethods: intent.permittedMethods, status: input.issue === false ? "draft" : "issued", metadata: input.metadata ?? {}, createdAt: now(), updatedAt: now(), issuedAt: input.issue === false ? undefined : now(), number: `MM-${new Date().getUTCFullYear()}-${++seq}` };
  intent.invoiceId = inv.id;
  rows.set(inv.id, inv); byIntent.set(intent.id, inv.id); touch("connect_invoices");
  enqueueEvent(`org:${inv.orgId}`, "invoice.created", publicInvoice(inv));
  return inv;
}
export const getInvoice = (id: string) => rows.get(id);
export const invoiceOfIntent = (intentId: string) => { const id = byIntent.get(intentId); return id ? rows.get(id) : undefined; };
export const invoicesOf = (orgId: string, env: string, limit = 100) => [...rows.values()].filter((r) => r.orgId === orgId && r.env === env).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
export function issueInvoice(inv: Invoice): Invoice { if (inv.status === "draft") { inv.status = "issued"; inv.issuedAt = now(); inv.updatedAt = now(); touch("connect_invoices"); } return inv; }
export function cancelInvoice(inv: Invoice): boolean { if (!["draft", "issued", "pending"].includes(inv.status)) return false; inv.status = "cancelled"; inv.updatedAt = now(); touch("connect_invoices"); return true; }
/** Intent status → invoice lifecycle (from the same hook that follows the engine). */
export function syncInvoice(i: PaymentIntent): void {
  const inv = invoiceOfIntent(i.id); if (!inv || inv.status === "cancelled") return;
  const next: InvoiceStatus = i.status === "completed" ? "paid" : i.status === "reversed" ? "refunded" : i.status === "expired" ? "expired" : ["authorized", "pending", "processing"].includes(i.status) ? "pending" : inv.status;
  if (next !== inv.status) { inv.status = next; inv.updatedAt = now(); if (next === "paid") { inv.paidAt = now(); enqueueEvent(`org:${inv.orgId}`, "invoice.paid", publicInvoice(inv)); } if (next === "expired") enqueueEvent(`org:${inv.orgId}`, "invoice.expired", publicInvoice(inv)); touch("connect_invoices"); }
}
export function publicInvoice(inv: Invoice) {
  const i = getIntent(inv.intentId); const payee = getMpi(inv.payee);
  return { id: inv.id, object: "invoice", number: inv.number, kind: inv.kind, status: inv.status, payee: { identity: inv.payee, display_name: payee?.displayName ?? null }, payer: inv.payer ? { identity: inv.payer.mpi ?? null, counterparty: inv.payer.counterparty ?? null, name: inv.payer.name ?? null } : null, amount: { value: String(inv.amount.value), currency: inv.amount.currency }, description: inv.description ?? null, reference: inv.reference ?? null, due_date: inv.dueDate ?? null, accepted_methods: inv.acceptedMethods, partial_payments: false, payment_intent: inv.intentId, payment_url: i ? checkoutUrl(i) : null, qr: i ? { text: checkoutUrl(i) } : null, lightning: i?.execution?.instruction ?? null, metadata: inv.metadata, created_at: inv.createdAt, issued_at: inv.issuedAt ?? null, paid_at: inv.paidAt ?? null, livemode: inv.env === "live" };
}
export function _resetInvoices(): void { rows.clear(); byIntent.clear(); }
