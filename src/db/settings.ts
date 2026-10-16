import { isPaperKey, OFFICE_MARGIN_MM, regionDefaults, type PaperKey } from '@/engine/paper';
import type { DisplayUnit, InchStyle } from '@/engine/units';

import { InvalidDataError } from './errors';
import { withRead, withWrite } from './tx';
import type { Db } from './types';

export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'system' | 'en' | 'de';
export type PpiTarget = 150 | 300 | 600;

/** SPEC §7 settings. Paper and unit default by region (D22) until the user picks one. */
export type AppSettings = {
  units: DisplayUnit;
  inchStyle: InchStyle;
  defaultPaper: PaperKey;
  defaultMarginMm: number;
  defaultOverlapMm: number;
  checkBar: boolean;
  ppiTarget: PpiTarget;
  lastProfileId: number | null;
  theme: ThemePreference;
  language: LanguagePreference;
  calibrationBannerDismissed: boolean;
};

const THEME_KEY = 'theme';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key));
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await withWrite(db, (tx) =>
    tx.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value
    )
  );
}

export async function getThemePreference(db: Db): Promise<ThemePreference> {
  const value = await getSetting(db, THEME_KEY);
  return THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system';
}

export function setThemePreference(db: Db, theme: ThemePreference): Promise<void> {
  return setSetting(db, THEME_KEY, theme);
}

type Codec<T> = { key: string; read: (raw: string) => T | undefined; write: (v: T) => string | undefined };

const oneOf = <T extends string>(key: string, values: readonly T[]): Codec<T> => ({
  key,
  read: (raw) => (values.includes(raw as T) ? (raw as T) : undefined),
  write: (v) => (values.includes(v) ? v : undefined),
});
const flag = (key: string): Codec<boolean> => ({
  key,
  read: (raw) => (raw === '1' ? true : raw === '0' ? false : undefined),
  write: (v) => (v ? '1' : '0'),
});
const length = (key: string, max: number): Codec<number> => ({
  key,
  read: (raw) => {
    const n = Number(raw);
    return raw !== '' && Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
  },
  write: (v) => (Number.isFinite(v) && v >= 0 && v <= max ? String(v) : undefined),
});

const CODECS: { [K in keyof AppSettings]: Codec<AppSettings[K]> } = {
  units: oneOf<DisplayUnit>('units', ['mm', 'cm', 'in']),
  inchStyle: oneOf<InchStyle>('inch_style', ['decimal', 'fraction16', 'fraction32']),
  defaultPaper: { key: 'default_paper', read: (r) => (isPaperKey(r) ? r : undefined), write: (v) => (isPaperKey(v) ? v : undefined) },
  defaultMarginMm: length('default_margin_mm', 50),
  defaultOverlapMm: length('default_overlap_mm', 100),
  checkBar: flag('check_bar'),
  ppiTarget: {
    key: 'ppi_target',
    read: (r) => ([150, 300, 600].includes(Number(r)) ? (Number(r) as PpiTarget) : undefined),
    write: (v) => ([150, 300, 600].includes(v) ? String(v) : undefined),
  },
  lastProfileId: {
    key: 'last_profile_id',
    read: (r) => (r === '' ? null : Number.isInteger(Number(r)) && Number(r) > 0 ? Number(r) : undefined),
    write: (v) => (v === null ? '' : Number.isInteger(v) && v > 0 ? String(v) : undefined),
  },
  theme: oneOf<ThemePreference>('theme', THEMES),
  language: oneOf<LanguagePreference>('language', ['system', 'en', 'de']),
  calibrationBannerDismissed: flag('calibration_banner_dismissed'),
};

/** Defaults; paper and unit depend on the device region (ISO 3166 code, e.g. from expo-localization in P6). */
export function defaultSettings(region: string | null | undefined): AppSettings {
  const r = regionDefaults(region);
  return {
    units: r.unit,
    inchStyle: r.inchStyle,
    defaultPaper: r.paper,
    defaultMarginMm: OFFICE_MARGIN_MM,
    defaultOverlapMm: 10,
    checkBar: true,
    ppiTarget: 300,
    lastProfileId: null,
    theme: 'system',
    language: 'system',
    calibrationBannerDismissed: false,
  };
}

/** All settings: stored values where valid, else the region default (a corrupt value never breaks the app). */
export async function getAppSettings(db: Db, region: string | null | undefined): Promise<AppSettings> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings'));
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = defaultSettings(region) as Record<keyof AppSettings, unknown>;
  for (const name of Object.keys(CODECS) as (keyof AppSettings)[]) {
    const raw = stored.get(CODECS[name].key);
    if (raw === undefined) continue;
    const v = CODECS[name].read(raw);
    if (v !== undefined) out[name] = v;
  }
  return out as AppSettings;
}

export async function setAppSetting<K extends keyof AppSettings>(db: Db, name: K, value: AppSettings[K]): Promise<void> {
  const codec = CODECS[name] as Codec<AppSettings[K]>;
  const raw = codec.write(value);
  if (raw === undefined) throw new InvalidDataError(`Invalid setting ${name}: ${String(value)}`);
  await setSetting(db, codec.key, raw);
}
