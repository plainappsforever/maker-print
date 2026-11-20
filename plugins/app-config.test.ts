/**
 * @jest-environment node
 */
// Pins the store-relevant parts of app.config.ts (store build part B, 2026-11-07): ids follow com.plainapps.<app>, no
// personal name; the Release guard refuses an unset APP_VARIANT; the team id comes only from APPLE_TEAM_ID; encryption off.
// Ids are derived from the config, never written here (a test with a literal bundle id breaks in the next app from the template).
const KEYS = ['APP_VARIANT', 'CONFIGURATION', 'APPLE_TEAM_ID'] as const;

function load(env: Partial<Record<(typeof KEYS)[number], string>>) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    let result: ReturnType<typeof import('../app.config').default> | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../app.config') as typeof import('../app.config');
      result = mod.default({ config: {} } as never);
    });
    return result!;
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe('app.config.ts store settings', () => {
  it('uses com.plainapps ids for every variant, production without suffix, no personal name', () => {
    const prod = load({ APP_VARIANT: 'production' });
    const id = prod.ios!.bundleIdentifier!;
    expect(id.startsWith('com.plainapps.')).toBe(true);
    expect(prod.android!.package).toBe(id);
    expect(load({ APP_VARIANT: 'preview' }).ios!.bundleIdentifier).toBe(`${id}.preview`);
    expect(load({ APP_VARIANT: 'development' }).ios!.bundleIdentifier).toBe(`${id}.dev`);
    expect(JSON.stringify([prod, load({ APP_VARIANT: 'preview' })]).includes('com.tim')).toBe(false);
  });

  it('refuses a Release build without APP_VARIANT but keeps the development default elsewhere', () => {
    expect(() => load({ CONFIGURATION: 'Release' })).toThrow(/APP_VARIANT is not set/);
    expect(load({ CONFIGURATION: 'Debug' }).extra!.appVariant).toBe('development');
    expect(load({}).extra!.appVariant).toBe('development');
    expect(load({ CONFIGURATION: 'Release', APP_VARIANT: 'production' }).extra!.appVariant).toBe('production');
  });

  it('takes the Apple team only from APPLE_TEAM_ID and declares no encryption of its own', () => {
    expect(load({ APP_VARIANT: 'production' }).ios!.appleTeamId).toBeUndefined();
    expect(load({ APP_VARIANT: 'production', APPLE_TEAM_ID: 'TEAM123456' }).ios!.appleTeamId).toBe('TEAM123456');
    expect(load({ APP_VARIANT: 'production' }).ios!.config!.usesNonExemptEncryption).toBe(false);
  });
});
