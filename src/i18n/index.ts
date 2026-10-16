// Minimal i18n: flat keys, {placeholder} interpolation, UI language set at startup (D22).
// 'system' = the device language (src/lib/locale.ts, expo-localization).
import type { Locale } from '@/engine/units';

import { de } from './de';
import { en, type TranslationKey } from './en';

export type { TranslationKey };
export const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, de };

let uiLanguage: Locale = 'en';
const listeners = new Set<() => void>();

export function setUiLanguage(lang: Locale) {
  if (lang === uiLanguage) return;
  uiLanguage = lang;
  for (const l of listeners) l();
}

/** For `useSyncExternalStore`: the navigator re-mounts its screens in the new language (Settings → Language). */
export function subscribeUiLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUiLanguage(): Locale {
  return uiLanguage;
}

/** 'de' for German locales ('de', 'de-AT', 'de_CH' …), else English. */
export function languageFromLocale(locale: string | null | undefined): Locale {
  return locale?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function translate(lang: Locale, key: TranslationKey, params: Record<string, string | number> = {}): string {
  const text = dictionaries[lang][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** UI string in the current UI language. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(uiLanguage, key, params);
}

/** Translator for words printed on paper (engine `GenContext.t`), fixed to one language. */
export function printTranslator(lang: Locale): (key: string, params?: Record<string, string | number>) => string {
  return (key, params) => translate(lang, key as TranslationKey, params);
}
