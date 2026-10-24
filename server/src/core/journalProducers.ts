/* ============================================================
   What writes to the domain journal, installed once at boot.

   Deliberately thin, and deliberately through the EXISTING onTransition hook rather than a
   new import inside the settlement engine: the engine already announces every transition to
   whoever asked, and a journal is just another listener. One place to turn off, and nothing
   new on the money path.

   Two producers to begin with, chosen because they are the two questions an operator
   actually asks of a journal — "what happened to this payment" and "what did we refuse":
   every state transition, and every delegation refusal. The rest of the vocabulary in
   core/journal.ts is declared but unproduced on purpose; a type that is listed and not yet
   emitted is a stated intention, a type that is emitted and not listed is a surprise.
   ============================================================ */
import { onTransition } from "./stateMachine.js";
import { emit } from "./journal.js";
import type { Payment } from "../../../shared/types.js";

let installed = false;
export function installJournalProducers(): void {
  if (installed) return; installed = true;
  onTransition((p: Payment) => {
    const last = p.events[p.events.length - 1];
    emit({
      type: "payment.transitioned",
      subject: { type: "payment", id: p.id },
      actor: { type: "system" },
      data: {
        ref: p.ref, to: p.state, xaf: p.xaf, method: p.method,
        ...(p.aggregator ? { rail: p.aggregator } : {}),
        // The NOTE is the diagnosis — every reason a payout holds is carried in it, so a
        // journal without it would record that something happened and not what.
        ...(last?.note ? { note: last.note } : {}),
      },
    });
  });
}
