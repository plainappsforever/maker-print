/**
 * @jest-environment node
 */
// A prebuild of another variant must not leave its URL scheme behind (meter-tracker V1 P6: its preview APK also claimed its dev scheme).
jest.mock('expo/config-plugins', () => ({
  withInfoPlist: (config: { plist?: unknown }, action: (c: { modResults: unknown }) => unknown) => (config.plist ? action({ ...config, modResults: config.plist }) : config),
  withAndroidManifest: (config: { manifest?: unknown }, action: (c: { modResults: unknown }) => unknown) => (config.manifest ? action({ ...config, modResults: config.manifest }) : config),
  AndroidConfig: { Manifest: { getMainApplicationOrThrow: (m: { manifest: { application: unknown[] } }) => m.manifest.application[0] } },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withOwnSchemeOnly = require('./with-own-scheme-only');
const ALL = ['makerprint-dev', 'makerprint-preview', 'makerprint'];

describe('with-own-scheme-only', () => {
  it('Android: keeps the own scheme, https and unrelated filters; drops the other variants', () => {
    const manifest = {
      manifest: {
        application: [
          {
            activity: [
              {
                'intent-filter': [
                  { category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }], data: [{ $: { 'android:scheme': 'makerprint-dev' } }, { $: { 'android:scheme': 'makerprint-preview' } }] },
                  { category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }], data: [{ $: { 'android:scheme': 'https' } }] },
                  { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }] },
                ],
              },
            ],
          },
        ],
      },
    };
    withOwnSchemeOnly({ manifest }, { own: 'makerprint-preview', all: ALL });
    const filters = manifest.manifest.application[0].activity[0]['intent-filter'] as { data?: { $: Record<string, string> }[] }[];
    expect(filters.flatMap((f) => (f.data ?? []).map((d) => d.$['android:scheme']))).toEqual(['makerprint-preview', 'https']);
    expect(filters).toHaveLength(3);
  });

  it('iOS: CFBundleURLSchemes keeps only the own scheme', () => {
    const plist = { CFBundleURLTypes: [{ CFBundleURLSchemes: ['makerprint-dev', 'makerprint-preview', 'com.tim.makerprint.preview'] }, { CFBundleURLSchemes: ['makerprint'] }] };
    withOwnSchemeOnly({ plist }, { own: 'makerprint-preview', all: ALL });
    expect(plist.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: ['makerprint-preview', 'com.tim.makerprint.preview'] }]);
  });
});
