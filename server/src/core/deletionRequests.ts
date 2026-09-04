/* ============================================================
   Deletion requests — the half of "delete my account" that cannot act on the spot.

   The account is the device, so the device can delete itself immediately and does (see
   POST /me/delete). Google Play also requires the deletion URL to serve someone who has
   uninstalled the app, and that person can prove nothing: no device, no login, only a
   phone number. The page used to tell them so and offer a contact link — a request that
   went nowhere anyone could audit.

   So a request is now a RECORD. It is filed against the canonical number, an operator is
   told, and it stays until someone marks how it was answered. Idempotent on the open
   request for a number: asking twice returns the same reference rather than opening a
   second case.
   ============================================================ */
import type { CountryCode, DeletionRequest } from "../../../shared/types.js";
import { phoneKey } from "../../../shared/domain.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";

const all: DeletionRequest[] = [];

register(
  "deletionRequests",
  () => all,
  (d: DeletionRequest[]) => { all.length = 0; all.push(...d); },
);

function shortRef(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — it is read back over the phone
  let s = "";
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return `DR-${s}`;
}

export function fileDeletionRequest(input: { phone: string; country: CountryCode; note?: string }): { record: DeletionRequest; isNew: boolean } {
  const key = phoneKey(input.phone, input.country);
  const open = all.find((r) => !r.resolvedAt && phoneKey(r.phone, r.country) === key);
  if (open) return { record: open, isNew: false };
  let ref = shortRef();
  while (all.some((r) => r.ref === ref)) ref = shortRef();
  const record: DeletionRequest = {
    id: id("delreq"),
    ref,
    phone: input.phone,
    country: input.country,
    note: input.note || undefined,
    createdAt: new Date().toISOString(),
  };
  all.unshift(record);
  touch("deletionRequests");
  return { record, isNew: true };
}

/** Newest first. */
export function listDeletionRequests(): DeletionRequest[] {
  return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveDeletionRequest(
  recordId: string,
  resolution: NonNullable<DeletionRequest["resolution"]>,
  note?: string,
): DeletionRequest | null {
  const r = all.find((x) => x.id === recordId);
  if (!r) return null;
  if (r.resolvedAt) return r; // an operator double-click changes nothing
  r.resolvedAt = new Date().toISOString();
  r.resolution = resolution;
  if (note) r.resolvedNote = note.slice(0, 500);
  touch("deletionRequests");
  return r;
}
