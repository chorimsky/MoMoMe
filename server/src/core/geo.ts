/* ============================================================
   Coarse geocoding for the public directory map. We never store precise
   storefront addresses — merchants give a free-text label like "Akwa, Douala".
   We resolve that to a CITY centroid (public knowledge) and apply a small,
   deterministic jitter keyed off the merchant code so multiple businesses in
   the same city spread out on the map instead of stacking on one pin.
   ============================================================ */
/** City centroids [lat, lng]. Keys are lowercased, accent-stripped city names. */
const CITIES: Record<string, [number, number]> = {
  // Cameroon
  douala: [4.0511, 9.7679],
  yaounde: [3.848, 11.5021],
  bamenda: [5.9597, 10.1459],
  bafoussam: [5.4781, 10.4176],
  garoua: [9.3017, 13.3921],
  maroua: [10.5957, 14.3247],
  ngaoundere: [7.3167, 13.5833],
  bertoua: [4.5776, 13.6846],
  buea: [4.1527, 9.241],
  limbe: [4.0186, 9.2147],
  kribi: [2.9391, 9.9098],
  kumba: [4.6363, 9.4469],
  ebolowa: [2.9, 11.15],
  edea: [3.8, 10.1333],
  dschang: [5.4468, 10.0537],
  foumban: [5.7167, 10.9],
  nkongsamba: [4.955, 9.9404],
  bafia: [4.75, 11.2333],
  sangmelima: [2.9333, 11.9833],
  tiko: [4.0752, 9.36],
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Stable 0..1 hash of a string → used for deterministic jitter. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Resolve a merchant's coarse map point from its candidate texts (location label
 * first, business name as a fallback — many are "Douala Print Shop"). Returns
 * undefined when no known city is found: we plot a business only where we can
 * place it confidently, since a wrong pin is worse than no pin for a locator.
 * `seed` (the merchant code) drives a ±~1.2km jitter so same-city pins separate.
 */
export function geocodeLabel(candidates: Array<string | undefined>, seed: string): { lat: number; lng: number } | undefined {
  let base: [number, number] | undefined;
  outer: for (const c of candidates) {
    if (!c) continue;
    const n = norm(c);
    for (const [city, coords] of Object.entries(CITIES)) {
      if (n.includes(city)) { base = coords; break outer; }
    }
  }
  if (!base) return undefined;
  // Deterministic jitter: ~±0.011° (~1.2 km) from two independent hashes.
  const jLat = (hash01(seed + "a") - 0.5) * 0.022;
  const jLng = (hash01(seed + "b") - 0.5) * 0.022;
  return { lat: +(base[0] + jLat).toFixed(5), lng: +(base[1] + jLng).toFixed(5) };
}
