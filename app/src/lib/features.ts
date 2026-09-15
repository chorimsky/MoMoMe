/* ============================================================
   Feature switches — a super-admin can turn product surfaces on/off from the
   admin console (AdminSettings.features). The client fetches them once from
   /config and hides anything disabled. Defaults are all-ON so nothing flickers
   away before the config loads, and a config failure never hides core surfaces.
   ============================================================ */
import { useEffect, useState } from "react";
import type { AppFeatures } from "@shared/types.js";
import { api } from "../api/client.js";

const DEFAULTS: AppFeatures = {
  directory: true, scanToPay: true, referrals: true, invoices: true, developerApi: true, diaspora: true,
  merchant: true, receive: true, contacts: true, momoTransfer: false, // admin-gated: off until the server says so
};

let _features: AppFeatures = DEFAULTS;
// The Pan-African network's customer entry points: OFF until /config says a corridor is open.
let _networkOpen = false;
const netSubs = new Set<(v: boolean) => void>();
let _loaded = false;    // set true only on a SUCCESSFUL load
let _inflight = false;  // a fetch is in progress → don't start another
const subs = new Set<(f: AppFeatures) => void>();

/** Reactive access to the feature switches. All-on until /config resolves. */
export function useFeatures(): AppFeatures {
  const [v, setV] = useState<AppFeatures>(_features);
  useEffect(() => {
    subs.add(setV);
    // Load once on success; a failed fetch leaves _loaded false so the next mount
    // retries (defaults stay all-ON meanwhile). _inflight prevents a request stampede
    // when several components mount before the first response.
    if (!_loaded && !_inflight) {
      _inflight = true;
      api.getConfig().then((c) => {
        _loaded = true;
        if (c.features) { _features = { ...DEFAULTS, ...c.features }; subs.forEach((s) => s(_features)); }
        _networkOpen = !!c.network?.enabled; netSubs.forEach((s) => s(_networkOpen));
      }).catch(() => { /* keep defaults; retry on a later mount */ })
        .finally(() => { _inflight = false; });
    }
    return () => { subs.delete(setV); };
  }, []);
  return v;
}

/** Is "send abroad" open for customers? False until /config resolves (never flickers on). */
export function useNetworkOpen(): boolean {
  const [v, setV] = useState(_networkOpen);
  useFeatures(); // shares the single /config load
  useEffect(() => { netSubs.add(setV); setV(_networkOpen); return () => { netSubs.delete(setV); }; }, []);
  return v;
}
