import { de } from './de';
import { en } from './en';
import { languageFromLocale, translate } from './index';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n parity', () => {
  it('German has exactly the English keys', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(Object.keys(en))('%s: same placeholders, non-empty in both languages', (key) => {
    const k = key as keyof typeof en;
    expect(en[k].trim()).not.toBe('');
    expect(de[k].trim()).not.toBe('');
    expect(placeholders(de[k])).toEqual(placeholders(en[k]));
  });

  it('interpolates and picks the language from a locale', () => {
    expect(translate('de', 'settings.version', { version: '1.0.0', variant: 'development' })).toBe('Version 1.0.0 (development)');
    expect(languageFromLocale('de-AT')).toBe('de');
    expect(languageFromLocale('en-US')).toBe('en');
    expect(languageFromLocale(null)).toBe('en');
  });
});
