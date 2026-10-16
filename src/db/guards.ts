// Hand-written guards for the JSON columns (V1_PLAN Architecture: no zod). Writes refuse invalid values
// (InvalidDataError); reads are tolerant — a corrupt cell becomes null/default, so one bad row never blocks the editor.
import { isValidCrop, type Crop } from '@/engine/geometry';
import type { Margins } from '@/engine/paper';

import { InvalidDataError } from './errors';

export type Repeat = { cols: number; rows: number; gap_x_mm: number; gap_y_mm: number; trim_marks: boolean };
export type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1000;
export const MAX_MARGIN_MM = 100;

export function isCrop(v: unknown): v is Crop {
  return isObj(v) && finite(v.l) && finite(v.t) && finite(v.r) && finite(v.b) && Object.keys(v).length === 4 && isValidCrop(v as Crop);
}

export function isRepeat(v: unknown): v is Repeat {
  return (
    isObj(v) &&
    count(v.cols) &&
    count(v.rows) &&
    finite(v.gap_x_mm) &&
    (v.gap_x_mm as number) >= 0 &&
    finite(v.gap_y_mm) &&
    (v.gap_y_mm as number) >= 0 &&
    typeof v.trim_marks === 'boolean'
  );
}

export function isMargins(v: unknown): v is Margins {
  return isObj(v) && (['l', 't', 'r', 'b'] as const).every((k) => finite(v[k]) && (v[k] as number) >= 0 && (v[k] as number) <= MAX_MARGIN_MM);
}

/** Tile keys (src/engine/tiles.ts tileKey): row letters + column number ("A1", "B12", "AA3") on sheet 1, "n:label" on sheet n ≥ 2 (D40). */
export function isTileLabels(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string' && /^(?:(?:[2-9]|[1-9]\d{1,2}):)?[A-Z]{1,2}[1-9]\d{0,2}$/.test(s));
}

export const isJsonObject = isObj;

function parse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Read side: the parsed value if it passes the guard, else `fallback`. */
export function readJson<T>(text: string | null, guard: (v: unknown) => v is T, fallback: T): T {
  const v = parse(text);
  return guard(v) ? v : fallback;
}

/** Write side: JSON text (or null for null), or InvalidDataError naming the column. */
export function writeJson<T>(value: T | null, guard: (v: unknown) => v is T, column: string): string | null {
  if (value === null) return null;
  if (!guard(value)) throw new InvalidDataError(`Invalid ${column}: ${JSON.stringify(value)}`);
  return JSON.stringify(value);
}

export const bool = (v: number | null): boolean => v === 1;
export const boolOrNull = (v: number | null): boolean | null => (v === null ? null : v === 1);
export const int = (b: boolean) => (b ? 1 : 0);

/** Positive finite length (sizes). */
export function requireLength(value: number, column: string, allowZero = false): number {
  if (!finite(value) || value < 0 || (!allowZero && value === 0)) throw new InvalidDataError(`Invalid ${column}: ${value}`);
  return value;
}

export function requireFinite(value: number, column: string): number {
  if (!finite(value)) throw new InvalidDataError(`Invalid ${column}: ${value}`);
  return value;
}

export function requireOneOf<T extends string>(value: T, allowed: readonly T[], column: string): T {
  if (!allowed.includes(value)) throw new InvalidDataError(`Invalid ${column}: ${value}`);
  return value;
}
