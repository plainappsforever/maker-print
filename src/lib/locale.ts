// Device region and language (expo-localization, D22): paper and unit defaults by region, 'system' language.
import { getLocales } from 'expo-localization';

import { languageFromLocale } from '@/i18n';
import type { Locale } from '@/engine/units';

const first = () => {
  try {
    return getLocales()[0] ?? null;
  } catch {
    return null;
  }
};

/** ISO 3166 region of the device ("US", "DE"), or null. */
export const deviceRegion = (): string | null => first()?.regionCode ?? null;

/** The device's UI language as one of ours (German locales → 'de', everything else English). */
export const deviceLanguage = (): Locale => languageFromLocale(first()?.languageTag ?? first()?.languageCode ?? null);

/** The UI language for a stored preference. */
export const resolveLanguage = (pref: 'system' | 'en' | 'de'): Locale => (pref === 'system' ? deviceLanguage() : pref);
