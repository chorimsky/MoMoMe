import type { Lang } from '@/lib/i18n';

/** Merchant categories — stored value is the English string (matches the web app). */
export const CATEGORIES = [
  'Restaurant',
  'Café / Bar',
  'Shop / Retail',
  'Hotel',
  'Freelancer',
  'Consultant',
  'Taxi / Transport',
  'Clinic',
  'Training centre',
  'Event / NGO',
  'Other',
] as const;

const CATEGORY_FR: Record<string, string> = {
  'Restaurant': 'Restaurant',
  'Café / Bar': 'Café / Bar',
  'Shop / Retail': 'Boutique / Commerce',
  Hotel: 'Hôtel',
  Freelancer: 'Indépendant',
  Consultant: 'Consultant',
  'Taxi / Transport': 'Taxi / Transport',
  Clinic: 'Clinique',
  'Training centre': 'Centre de formation',
  'Event / NGO': 'Événement / ONG',
  Other: 'Autre',
};

/** Translate a category for display while keeping the stored English value. */
export function categoryLabel(value: string, lang: Lang): string {
  return lang === 'fr' ? CATEGORY_FR[value] ?? value : value;
}
