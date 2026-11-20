// D24: the identity file is well-formed, readable (WCAG 2.1 contrast) and replaced before an app ships.
import fs from 'node:fs';
import path from 'node:path';

import brandJson from './brand.json';
import { Brand, Colors } from './theme';

const ROOT = path.join(__dirname, '..', '..');
// The template's own neutral placeholder accent. An app that still ships it never got its identity.
const PLACEHOLDER_ACCENT = { light: '#6B6B6B', dark: '#A3A3A3' };
// The blue every app shared before D24 (tint, dark tint, splash, Android icon background, linkPrimary).
const OLD_BLUES = ['#0A6BD8', '#4DA3FF', '#208AEF', '#E6F4FE', '#3C87F7'];
// app.config.ts evaluated per variant; the template is recognised by its slug, which new-app.sh rewrites.
const TEMPLATE_SLUG = 'mobile-starter';

type Config = {
  slug: string;
  android: { adaptiveIcon: { backgroundColor: string } };
  plugins: (string | [string, Record<string, unknown>])[];
};

function loadConfig(variant: string): Config {
  let cfg = {} as Config;
  jest.isolateModules(() => {
    const before = process.env.APP_VARIANT;
    process.env.APP_VARIANT = variant;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cfg = require('../../app.config.ts').default({ config: {} });
    } finally {
      if (before === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = before;
    }
  });
  return cfg;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every colour a release config and the identity file ship that is an old blue or the placeholder accent. */
function identityProblems(cfg: Config) {
  const splash = cfg.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as [string, any];
  const shipped: Record<string, string> = {
    'splash background': splash[1].backgroundColor,
    'splash dark background': splash[1].dark?.backgroundColor,
    'Android icon background': cfg.android.adaptiveIcon.backgroundColor,
    'light accent': Brand.light.accent,
    'dark accent': Brand.dark.accent,
    'light accentText': Brand.light.accentText,
    'dark accentText': Brand.dark.accentText,
  };
  const problems: string[] = [];
  for (const [what, value] of Object.entries(shipped)) {
    if (OLD_BLUES.includes(String(value).toUpperCase())) problems.push(`${what} is the old template blue ${value}`);
  }
  for (const scheme of ['light', 'dark'] as const) {
    if (Brand[scheme].accent.toUpperCase() === PLACEHOLDER_ACCENT[scheme]) {
      problems.push(`${scheme} accent is the template placeholder ${PLACEHOLDER_ACCENT[scheme]}`);
    }
  }
  return problems;
}

describe('brand.json shape', () => {
  test('only the known keys and values', () => {
    const { _doc, ...rest } = brandJson as typeof brandJson & { _doc?: string };
    expect(typeof _doc).toBe('string');
    expect(Object.keys(rest).sort()).toEqual(['card', 'dark', 'density', 'fonts', 'light', 'radius']);
    for (const role of ['title', 'body', 'numerals'] as const) {
      expect(['sans', 'rounded', 'serif', 'mono']).toContain(Brand.fonts[role]);
    }
    expect(Object.keys(Brand.fonts).sort()).toEqual(['body', 'numerals', 'title']);
    expect(['flat', 'outlined', 'elevated']).toContain(Brand.card);
    expect(['compact', 'regular', 'airy']).toContain(Brand.density);
    for (const r of [Brand.radius.control, Brand.radius.card]) expect(r >= 0 && Number.isFinite(r)).toBe(true);
  });

  test.each(['light', 'dark'] as const)('%s: six #RRGGBB colours', (scheme) => {
    expect(Object.keys(Brand[scheme]).sort()).toEqual(['accent', 'accentText', 'background', 'border', 'onAccent', 'surface']);
    for (const v of Object.values(Brand[scheme])) expect(v).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('contrast (WCAG 2.1, 4.5:1 for text)', () => {
  test.each(['light', 'dark'] as const)('%s', (scheme) => {
    const b = Brand[scheme];
    expect(contrast(b.onAccent, b.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(b.accentText, b.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(b.accentText, b.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Colors[scheme].text, b.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Colors[scheme].textSecondary, b.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe.each(['preview', 'production'])('%s variant ships its own identity', (variant) => {
  const cfg = loadConfig(variant);

  test('no old blue, no placeholder accent (the template itself must still show the placeholder)', () => {
    const problems = identityProblems(cfg);
    if (cfg.slug === TEMPLATE_SLUG) {
      expect(problems).toEqual([
        `light accent is the template placeholder ${PLACEHOLDER_ACCENT.light}`,
        `dark accent is the template placeholder ${PLACEHOLDER_ACCENT.dark}`,
      ]);
    } else {
      expect(problems).toEqual([]);
    }
  });
});

test('no old template blue written as a literal in src/ or app.config.ts', () => {
  const hits: string[] = [];
  const scan = (file: string) => {
    const text = fs.readFileSync(file, 'utf8').toUpperCase();
    for (const blue of OLD_BLUES) if (text.includes(blue)) hits.push(`${path.relative(ROOT, file)}: ${blue}`);
  };
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|json)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.generated.json')) scan(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  scan(path.join(ROOT, 'app.config.ts'));
  expect(hits).toEqual([]);
});
