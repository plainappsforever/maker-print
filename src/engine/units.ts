// Units: conversions, parsing and formatting of lengths (SPEC §8.1, D19, D31, D32). Pure — no React/Expo imports.
// Every engine length is millimetres (double). Points exist only at the PDF boundary (mmToPt).

export const MM_PER_IN = 25.4;
export const PT_PER_IN = 72;
export const MAX_LENGTH_MM = 10_000;
/** Engine comparison tolerance (D19). */
export const EPS_MM = 1e-6;

export type DisplayUnit = 'mm' | 'cm' | 'in';
export type InchStyle = 'decimal' | 'fraction16' | 'fraction32';
export type Locale = 'en' | 'de';
export type SvgPpi = 96 | 72 | 90 | number;

/**
 * mm → pt. For millimetre values with ≤ 6 decimals (every paper size, every typed length) the result is the
 * correctly rounded double of the exact decimal: integer µm × 72 / 25 400 000 is one exact product and one
 * division (D38) — so Letter 215.9 mm is 612 pt exactly, not 612.0000000000001 as `215.9 * 72 / 25.4` gives.
 */
export const mmToPt = (mm: number) => {
  const um = Math.round(mm * 1e6);
  return Math.abs(um / 1e6 - mm) <= Math.abs(mm) * 1e-15 && Math.abs(um) < 2 ** 46 ? (um * PT_PER_IN) / 25_400_000 : (mm * PT_PER_IN) / MM_PER_IN;
};
export const ptToMm = (pt: number) => (pt * MM_PER_IN) / PT_PER_IN;
export const mmToIn = (mm: number) => mm / MM_PER_IN;
export const inToMm = (inches: number) => inches * MM_PER_IN;
/** SVG/CSS pixel at `ppi` pixels per inch → mm (96 most apps, 72 Illustrator, 90 old Inkscape). */
export const pxToMm = (px: number, ppi: SvgPpi) => (px * MM_PER_IN) / ppi;
export const mmToPx = (mm: number, ppi: SvgPpi) => (mm * ppi) / MM_PER_IN;

/** True when two lengths are equal within the engine tolerance. */
export const sameMm = (a: number, b: number, eps = EPS_MM) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------------------------------------ parsing

const UNIT_FACTORS: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: MM_PER_IN,
  inch: MM_PER_IN,
  inches: MM_PER_IN,
  zoll: MM_PER_IN,
  '"': MM_PER_IN,
  '”': MM_PER_IN, // ” — iOS smart punctuation turns " into this
  '“': MM_PER_IN, // “
  '″': MM_PER_IN, // ″ double prime
  "''": MM_PER_IN,
  '’’': MM_PER_IN,
  pt: MM_PER_IN / PT_PER_IN,
};

export type ParseError = 'empty' | 'invalid' | 'negative' | 'zero' | 'tooLarge' | 'ambiguous';
export type ParseResult = { ok: true; mm: number } | { ok: false; error: ParseError };
export type ParseOptions = {
  /** Unit for numbers typed without one (the current display unit). */
  unit: DisplayUnit;
  locale: Locale;
  /** Positions may be negative (object partly off the sheet); sizes may not. Default false. */
  allowNegative?: boolean;
  /** Sizes: 0 is refused with its own message (P3.5 finding 17 — the DB CHECK must not be the first to say no). */
  positive?: boolean;
};

const VULGAR: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅓': '1/3', '⅔': '2/3', '⅙': '1/6', '⅚': '5/6', '⅕': '1/5' };

// number forms: "3 1/16", "3-1/16", "3 - 1/16", "1/2", "7,5", "7.5", ".5", "78"
const MIXED = /^(\d+)(?:\s*-\s*|\s+)(\d+)\s*\/\s*(\d+)/;
const FRACTION = /^(\d+)\s*\/\s*(\d+)/;
const DECIMAL = /^(\d*)(?:([.,])(\d+))?/;

/**
 * Parses a typed length into mm (SPEC §8.1). Accepts both decimal separators in both locales (D31); a value is
 * refused as `ambiguous` when the separator is the locale's thousands separator followed by exactly three digits
 * ("1,000" in English, "1.000" in German) — we never guess between 1 and 1000.
 */
export function parseLength(text: string, options: ParseOptions): ParseResult {
  let s = text.trim().replace(/^[≈~]\s*/, ''); // a formatted "≈ 3 15/16 in" parses back
  // "3 ½ in", "3½\"", "½\"" and the fraction slash (finding 17)
  s = s.replace(/⁄/g, '/').replace(/(\d)\s*([½¼¾⅛⅜⅝⅞⅓⅔⅙⅚⅕])/g, (_, d: string, g: string) => `${d} ${VULGAR[g]}`).replace(/[½¼¾⅛⅜⅝⅞⅓⅔⅙⅚⅕]/g, (g) => VULGAR[g]);
  if (s === '') return { ok: false, error: 'empty' };
  let negative = false;
  if (/^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1).trimStart();
  }

  let value: number;
  let rest: string;
  const mixed = MIXED.exec(s);
  const fraction = mixed ? null : FRACTION.exec(s);
  if (mixed) {
    const [whole, num, den] = [Number(mixed[1]), Number(mixed[2]), Number(mixed[3])];
    if (den === 0 || num >= den) return { ok: false, error: 'invalid' };
    value = whole + num / den;
    rest = s.slice(mixed[0].length);
  } else if (fraction) {
    const [num, den] = [Number(fraction[1]), Number(fraction[2])];
    if (den === 0) return { ok: false, error: 'invalid' };
    value = num / den;
    rest = s.slice(fraction[0].length);
  } else {
    const dec = DECIMAL.exec(s);
    if (!dec || (dec[1] === '' && dec[3] === undefined)) return { ok: false, error: 'invalid' };
    const [, int, sep, frac] = dec;
    if (sep && frac.length === 3 && Number(int) > 0 && sep === (options.locale === 'de' ? '.' : ',')) {
      return { ok: false, error: 'ambiguous' };
    }
    value = Number(`${int || '0'}${frac !== undefined ? `.${frac}` : ''}`);
    rest = s.slice(dec[0].length);
  }

  const unitText = rest.trim().toLowerCase();
  const factor = unitText === '' ? UNIT_FACTORS[options.unit] : UNIT_FACTORS[unitText];
  if (factor === undefined || !Number.isFinite(value)) return { ok: false, error: 'invalid' };
  const mm = value * factor;
  if (negative && mm !== 0 && !options.allowNegative) return { ok: false, error: 'negative' };
  if (options.positive && mm === 0) return { ok: false, error: 'zero' };
  if (mm > MAX_LENGTH_MM + EPS_MM) return { ok: false, error: 'tooLarge' };
  return { ok: true, mm: negative && mm !== 0 ? -mm : mm };
}

// ------------------------------------------------------------------------------------------------ formatting

/** Rounds |x| to a multiple of `step`, ties up; float noise (1.005 × 100 = 100.4999…) is cleaned first (D32). */
function roundSteps(x: number, step: number): number {
  return Math.round(Number((Math.abs(x) / step).toPrecision(12)));
}

function decimalText(x: number, places: number, locale: Locale): string {
  const steps = roundSteps(x, 10 ** -places);
  let s = (steps / 10 ** places).toFixed(places);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (locale === 'de') s = s.replace('.', ',');
  return x < 0 && steps !== 0 ? `-${s}` : s;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export type FormatOptions = { unit: DisplayUnit; inchStyle?: InchStyle; locale: Locale; withUnit?: boolean };

/** Display precision per unit/style: the largest error `formatLength` may introduce (half a display step), in mm. */
export function displayPrecisionMm(unit: DisplayUnit, inchStyle: InchStyle = 'decimal'): number {
  if (unit === 'mm') return 0.005;
  if (unit === 'cm') return 0.0005 * 10;
  if (inchStyle === 'decimal') return 0.00005 * MM_PER_IN;
  return (MM_PER_IN / (inchStyle === 'fraction16' ? 16 : 32)) / 2;
}

/**
 * Formats mm for display (D32): mm with ≤ 2 decimals, cm ≤ 3, decimal inches ≤ 4 (trailing zeros dropped, locale
 * decimal separator); inch fractions to the nearest 1/16 or 1/32, reduced ("3 1/16 in"), prefixed "≈ " whenever the
 * fraction is not the exact value — we never present a rounded size as exact (L26).
 */
export function formatLength(mm: number, options: FormatOptions): string {
  const { unit, locale, inchStyle = 'decimal', withUnit = true } = options;
  const suffix = withUnit ? ` ${unit}` : '';
  if (unit === 'mm') return decimalText(mm, 2, locale) + suffix;
  if (unit === 'cm') return decimalText(mm / 10, 3, locale) + suffix;
  const inches = mm / MM_PER_IN;
  if (inchStyle === 'decimal') return decimalText(inches, 4, locale) + suffix;
  const den = inchStyle === 'fraction16' ? 16 : 32;
  const steps = roundSteps(inches, 1 / den);
  const whole = Math.floor(steps / den);
  let num = steps % den;
  let d = den;
  if (num) {
    const g = gcd(num, d);
    num /= g;
    d /= g;
  }
  const body = num === 0 ? `${whole}` : whole === 0 ? `${num}/${d}` : `${whole} ${num}/${d}`;
  const exact = Math.abs(steps / den - Math.abs(inches)) * MM_PER_IN <= EPS_MM;
  const sign = mm < 0 && steps !== 0 ? '-' : '';
  return `${exact ? '' : '≈ '}${sign}${body}${suffix}`;
}
