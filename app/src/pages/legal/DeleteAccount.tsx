/* Account and data deletion — the public URL Google Play requires.
 *
 * Play's Data Safety section cannot be completed by an app that lets people create an
 * account unless deletion is offered BOTH in the app and at a web address reachable by
 * someone who has already uninstalled it. This is that address.
 *
 * It is deliberately a page that DOES the thing rather than a form that emails a request:
 * the account here is the device, so the browser presenting the device id is the only
 * party that can prove ownership, and it can act immediately. A person on a different
 * device gets told plainly why the button cannot help them, instead of a request that
 * silently goes nowhere.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CountryCode } from "@shared/types.js";
import { COUNTRIES, checkPhone } from "@shared/domain.js";
import { DocShell, Sec, Summary } from "./LegalLayout.js";
import { api, ApiError } from "../../api/client.js";

interface DeleteResult {
  deleted: { contacts: number; device: boolean; referrals: boolean };
  retained: { payments: number; reason: string };
}

export function DeleteAccount() {
  const [state, setState] = useState<"idle" | "confirming" | "working" | "done" | "error">("idle");
  const [result, setResult] = useState<DeleteResult | null>(null);
  const [error, setError] = useState<string>("");
  const [noDevice, setNoDevice] = useState(false);

  // The request form, for someone reading this on a device that is not their MoMo›Me
  // account (an uninstalled app, a different phone, a Play reviewer). They cannot prove
  // ownership, so nothing is deleted here — the request is put on record and answered.
  const [rqCountry, setRqCountry] = useState<CountryCode>("CM");
  const [rqPhone, setRqPhone] = useState("");
  const [rqNote, setRqNote] = useState("");
  const [rqState, setRqState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [rqRef, setRqRef] = useState<{ ref: string; alreadyOpen: boolean } | null>(null);
  const [rqError, setRqError] = useState("");
  const rqCheck = checkPhone(rqPhone, rqCountry);

  useEffect(() => { document.title = "Delete your account · MoMo›Me"; }, []);

  async function request() {
    setRqState("working"); setRqError("");
    try {
      const r = await api.requestDeletion({ phone: rqCheck.local, country: rqCountry, note: rqNote.trim() || undefined });
      setRqRef({ ref: r.ref, alreadyOpen: r.alreadyOpen });
      setRqState("done");
    } catch (e) {
      setRqError(e instanceof Error ? e.message : "Something went wrong.");
      setRqState("error");
    }
  }

  async function run() {
    setState("working");
    try {
      const r = await api.deleteAccount();
      setResult(r);
      setState("done");
    } catch (e) {
      // "Unrecognised device" is not a failure — it is the ordinary case for someone who
      // has uninstalled the app. Send them to the form instead of a dead end.
      if (e instanceof ApiError && e.status === 401) setNoDevice(true);
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  }

  return (
    <DocShell kicker="Legal" title="Delete your account" updated="3 September 2026" current="privacy">
      <Summary>
        You can delete your MoMo›Me account and the data tied to it from this page, on this device.
        Your saved contacts, this device’s keys and your referral links go immediately. Records of
        payments you have already sent are kept, because the law that governs money transfer requires it.
      </Summary>

      <Sec n="01" title="What gets deleted">
        <ul>
          <li><strong>Your saved contacts</strong> — the encrypted address book kept for you. It is stored
            end-to-end encrypted, so we have never been able to read it; deleting it destroys the ciphertext.</li>
          <li><strong>This device</strong> — its enrolment and the public keys that made it your account.</li>
          <li><strong>Your referral links</strong> — your code, who referred you, and your place in anyone
            else’s referral list.</li>
        </ul>
      </Sec>

      <Sec n="02" title="What we have to keep, and why">
        <p>
          Records of payments you have already sent stay. Moving money makes us a regulated money
          transmitter, and anti-money-laundering law requires those records be retained for several years —
          we are not permitted to erase them on request, and our books are double-entry, so removing one
          side of a completed payment would unbalance it for everyone else involved. What we can do, and
          do here, is cut the link between those records and a device you control. They are covered in
          full by our <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </Sec>

      <Sec n="03" title="Delete now">
        <p>
          This acts on <strong>this browser or app install</strong>, which is what identifies your account.
          If you are reading this somewhere else, open it on the device you used MoMo›Me on — we have no
          other way to know the account is yours, and we would rather say so than take a request we cannot
          verify. This cannot be undone.
        </p>

        {state === "idle" && (
          <p>
            <button type="button" className="btn btn-danger" onClick={() => setState("confirming")}>
              Delete my account
            </button>
          </p>
        )}

        {state === "confirming" && (
          <p>
            <strong>Delete your account and its data from this device?</strong> This cannot be undone.{" "}
            <button type="button" className="btn btn-danger" onClick={run}>Yes, delete it</button>{" "}
            <button type="button" className="btn" onClick={() => setState("idle")}>Cancel</button>
          </p>
        )}

        {state === "working" && <p>Deleting…</p>}

        {state === "done" && result && (
          <>
            <p><strong>Done.</strong> Here is exactly what happened:</p>
            <ul>
              <li>{result.deleted.contacts} saved contact{result.deleted.contacts === 1 ? "" : "s"} deleted</li>
              <li>{result.deleted.device ? "This device’s keys were removed" : "This device had no keys stored"}</li>
              <li>{result.deleted.referrals ? "Referral links removed" : "No referral links to remove"}</li>
              <li>
                {result.retained.payments} past payment record
                {result.retained.payments === 1 ? "" : "s"} kept — {result.retained.reason}
              </li>
            </ul>
          </>
        )}

        {state === "error" && noDevice && (
          <p>
            <strong>This browser is not a MoMo›Me account</strong> — it has never been used to send money
            here, so there is nothing tied to it that we could delete. If you used the app on a phone you
            no longer have, use the request form below and we will handle it by hand.
          </p>
        )}
        {state === "error" && !noDevice && (
          <p>
            We couldn’t complete that: {error} If this keeps happening, use the request form below or the{" "}
            <Link to="/contact">contact page</Link> and we will handle it by hand.
          </p>
        )}
      </Sec>

      <Sec n="04" title="Not on that device any more? Ask us">
        <p>
          If you have uninstalled the app or lost the phone, tell us the Mobile Money number you used
          with MoMo›Me. We can’t verify ownership from here, so nothing is deleted on the spot: your request
          is put on record with a reference, we confirm the number is yours, and we delete what we can
          within 30 days. Keep the reference.
        </p>
        {rqState !== "done" && (
          <form onSubmit={(e) => { e.preventDefault(); if (rqCheck.ok) void request(); }} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              Country
              <select value={rqCountry} onChange={(e) => setRqCountry(e.target.value as CountryCode)}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", font: "inherit" }}>
                {Object.values(COUNTRIES).map((co) => <option key={co.code} value={co.code}>{co.dial} {co.name}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              Mobile Money number
              <input value={rqPhone} onChange={(e) => setRqPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="6 80 34 44 85"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", font: "inherit", fontFamily: "var(--font-mono)" }} />
              {rqPhone.replace(/\D/g, "").length >= 8 && !rqCheck.ok && (
                <span style={{ color: "var(--warn-ink)", fontSize: 12.5 }}>That doesn’t look like a {COUNTRIES[rqCountry].name} Mobile Money number — check the digits and the country.</span>
              )}
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              Anything we should know (optional)
              <textarea value={rqNote} onChange={(e) => setRqNote(e.target.value.slice(0, 500))} rows={2}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", font: "inherit", resize: "vertical" }} />
            </label>
            {rqState === "error" && <p style={{ color: "var(--bad)", margin: 0 }}>{rqError}</p>}
            <p style={{ margin: 0 }}>
              <button type="submit" className="btn btn-danger" disabled={!rqCheck.ok || rqState === "working"}>
                {rqState === "working" ? "Sending…" : "Request deletion"}
              </button>
            </p>
          </form>
        )}
        {rqState === "done" && rqRef && (
          <p>
            <strong>{rqRef.alreadyOpen ? "We already have this request." : "Received."}</strong> Your reference is{" "}
            <strong style={{ fontFamily: "var(--font-mono)" }}>{rqRef.ref}</strong>. We will confirm the number is yours and
            answer within 30 days. If you need to follow up, quote that reference on the <Link to="/contact">contact page</Link>.
          </p>
        )}
      </Sec>
    </DocShell>
  );
}
