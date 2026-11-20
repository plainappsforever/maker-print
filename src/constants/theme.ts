/**
 * Design tokens (D24, docs/DESIGN_TOKENS.md). An app's identity lives in ONE file, `./brand.json`: accent and neutral
 * colours for light and dark, the font family per role, corner radii, card style and spacing density. Everything below
 * is derived from it; screens and components read `Colors` (via `useTheme()`), `BrandFonts`, `Radius`, `Spacing` and
 * `<Card>`, never a literal colour, radius or font name.
 */

import { Platform } from 'react-native';

import brandJson from './brand.json';

export type FontFamilyName = 'sans' | 'rounded' | 'serif' | 'mono';
export type CardStyle = 'flat' | 'outlined' | 'elevated';
export type Density = 'compact' | 'regular' | 'airy';

type BrandColors = {
  /** Fills: primary button, selected segment, big numerals, shapes. */
  accent: string;
  /** Text and icons drawn ON the accent fill. */
  onAccent: string;
  /** Accent for text and small icons on background/surface (4.5:1; may equal accent). */
  accentText: string;
  /** Screen background (the sheet's neutral tone). */
  background: string;
  /** Cards, inputs, segmented tracks. */
  surface: string;
  /** Hairlines: outlined cards, inputs, dark-mode edge of elevated cards. */
  border: string;
};

export type BrandTokens = {
  light: BrandColors;
  dark: BrandColors;
  fonts: { title: FontFamilyName; body: FontFamilyName; numerals: FontFamilyName };
  radius: { control: number; card: number };
  card: CardStyle;
  density: Density;
};

/** Shape and contrast pinned by `src/constants/brand.test.ts`. */
export const Brand = brandJson as BrandTokens;

// Neutrals the identity sheets do not set. Same for every app; only change them with a reason in the app's DECISIONS.
const NEUTRAL = {
  light: { text: '#000000', textSecondary: '#60646C', backgroundSelected: '#E0E1E6', danger: '#C62828', warn: '#E65100', warnFill: '#E65100', grid: '#DCD7D1', sheetBack: '#D9DCE1', paper: '#FFFFFF' },
  dark: { text: '#ffffff', textSecondary: '#B0B4BA', backgroundSelected: '#2E3135', danger: '#FF6B6B', warn: '#FFA040', warnFill: '#E65100', grid: '#46413D', sheetBack: '#3A3B3E', paper: '#FFFFFF' },
} as const;

function palette(scheme: 'light' | 'dark') {
  const b = Brand[scheme];
  return {
    ...NEUTRAL[scheme],
    background: b.background,
    backgroundElement: b.surface,
    border: b.border,
    tint: b.accent,
    onTint: b.onAccent,
    tintText: b.accentText,
  };
}

export const Colors = { light: palette('light'), dark: palette('dark') };

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Family names React Native 0.86 accepts. iOS: the four `UIFontDescriptorSystemDesign` variants (RCTFontUtils.mm maps
// system-ui / ui-rounded / ui-serif / ui-monospace to SF Pro, SF Pro Rounded, New York, SF Mono). Android: built-in
// families only, no bundled font files; there is no rounded system family, so `rounded` falls back to Roboto.
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** Font family per role, resolved for this platform. Numbers also get `fontVariant: ['tabular-nums']` (ThemedText `numeric`). */
export const BrandFonts = {
  title: Fonts[Brand.fonts.title],
  body: Fonts[Brand.fonts.body],
  numerals: Fonts[Brand.fonts.numerals],
};

const DENSITY_SCALE: Record<Density, number> = { compact: 0.75, regular: 1, airy: 1.25 };
const d = DENSITY_SCALE[Brand.density];
const space = (n: number) => Math.round(n * d);

/** Spacing scale; `density` stretches or shrinks every step. */
export const Spacing = {
  half: space(2),
  one: space(4),
  two: space(8),
  three: space(16),
  four: space(24),
  five: space(32),
  six: space(64),
} as const;

/** Corner radii. `inner` = a control nested inside a control (segment in a segmented track). */
export const Radius = {
  control: Brand.radius.control,
  card: Brand.radius.card,
  inner: Math.max(0, Brand.radius.control - Spacing.one),
};

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/** Editor selection handles, safe-area and printable-area lines: drawn on the white paper in both schemes, so the light accent (D24). */
export const SelectColor = Brand.light.accent;
