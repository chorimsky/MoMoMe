/* Merchant categories — the stored `value` is ALWAYS the English string (used for
   filtering/matching server-side); `en`/`fr` are display labels only. */
export const CATEGORIES: Array<{ value: string; en: string; fr: string }> = [
  { value: "Restaurant", en: "Restaurant", fr: "Restaurant" },
  { value: "Café / Bar", en: "Café / Bar", fr: "Café / Bar" },
  { value: "Shop / Retail", en: "Shop / Retail", fr: "Boutique / Commerce" },
  { value: "Hotel", en: "Hotel", fr: "Hôtel" },
  { value: "Freelancer", en: "Freelancer", fr: "Indépendant" },
  { value: "Consultant", en: "Consultant", fr: "Consultant" },
  { value: "Taxi / Transport", en: "Taxi / Transport", fr: "Taxi / Transport" },
  { value: "Clinic", en: "Clinic", fr: "Clinique" },
  { value: "Training centre", en: "Training centre", fr: "Centre de formation" },
  { value: "Event / NGO", en: "Event / NGO", fr: "Événement / ONG" },
  { value: "Other", en: "Other", fr: "Autre" },
];

export const catLabel = (value: string, lang: "en" | "fr"): string =>
  CATEGORIES.find((c) => c.value === value)?.[lang] ?? value;
