// Shared inputs and helpers for generated content (D45). Pure.
import { BLACK, type Rgb, type TextItem } from '../path';
import { textWidthMm } from '../text-metrics';
import { formatLength, type DisplayUnit, type InchStyle, type Locale } from '../units';

/** Translator for printed words (the UI passes i18n's `translate` bound to the print language). */
export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type GenContext = { locale: Locale; unit: DisplayUnit; inchStyle: InchStyle; t: Translate };

export type Props = Record<string, unknown>;
export const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
export const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** '#rrggbb' → [r, g, b] in 0…1; anything else → fallback. */
export function colour(v: unknown, fallback: Rgb = BLACK): Rgb {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return fallback;
  const n = parseInt(v.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Text item with its baseline at y, horizontally centred on cx (or aligned), clamped into [lo, hi] when given. */
export function textAt(text: string, x: number, y: number, sizeMm: number, align: 'left' | 'centre' | 'right' = 'left', clamp?: [number, number], c: Rgb = BLACK): TextItem {
  const w = textWidthMm(text, sizeMm);
  let left = align === 'left' ? x : align === 'centre' ? x - w / 2 : x - w;
  if (clamp) left = Math.min(Math.max(left, clamp[0]), clamp[1] - w);
  return { x: left, y, sizeMm, text, colour: c };
}

/** Number for printed labels in the print language (decimal comma in German), up to 3 decimals. */
export function labelNumber(v: number, locale: Locale): string {
  const s = String(Number(v.toFixed(3)));
  return locale === 'de' ? s.replace('.', ',') : s;
}

/** A length for printing: like the UI's format, but "≈" (not in WinAnsi) becomes "~" — still marked as rounded. */
export function printLength(mm: number, ctx: Pick<GenContext, 'unit' | 'inchStyle' | 'locale'>, withUnit = true): string {
  return formatLength(mm, { unit: ctx.unit, inchStyle: ctx.inchStyle, locale: ctx.locale, withUnit }).replace(/^≈\s*/, '~');
}
