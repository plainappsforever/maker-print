/**
 * @jest-environment node
 */
// P7 (D82): the preview/production manifest must not carry INTERNET, and the upload-key signing patch must be idempotent.
jest.mock('expo/config-plugins', () => ({
  withAndroidManifest: (config: { manifest?: unknown }, action: (c: { modResults: unknown }) => unknown) => action({ ...config, modResults: config.manifest ?? { manifest: { $: {} } } }),
  withAppBuildGradle: (config: unknown) => config,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withNoInternet = require('./with-no-internet');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apply } = require('./with-release-signing');

describe('with-no-internet', () => {
  it('drops INTERNET and marks it removed so a library manifest cannot bring it back; keeps other permissions', () => {
    const manifest = {
      manifest: {
        $: {},
        'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }, { $: { 'android:name': 'android.permission.VIBRATE' } }],
      },
    };
    const out = withNoInternet({ manifest }).modResults.manifest;
    const perms = out['uses-permission'] as { $: Record<string, string> }[];
    expect(perms.filter((p) => p.$['android:name'] === 'android.permission.INTERNET' && p.$['tools:node'] !== 'remove')).toHaveLength(0);
    expect(perms.some((p) => p.$['android:name'] === 'android.permission.INTERNET' && p.$['tools:node'] === 'remove')).toBe(true);
    expect(perms.some((p) => p.$['android:name'] === 'android.permission.VIBRATE')).toBe(true);
    expect(out.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });
});

describe('with-release-signing', () => {
  const gradle = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}`;
  it('adds a release config that needs keystore.properties, falls back to debug, and is idempotent', () => {
    const once = apply(gradle) as string;
    expect(once).toContain('keystore.properties');
    expect(once).toContain('signingConfigs.release : signingConfigs.debug');
    expect(apply(once)).toBe(once);
  });
});

describe('with-release-no-dev-client (v1.1, RELEASE_KIT 1c item 14)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { gradle, podfile } = require('./with-release-no-dev-client');
  const settings = "plugins {\n  id(\"expo-autolinking-settings\")\n}\nexpoAutolinking.useExpoModules()\n\nrootProject.name = 'X'\n";
  const pods = "target 'X' do\n  use_expo_modules!\n\n  config = use_native_modules!(config_command)\nend\n";
  it('release: the dev-client pods are excluded on iOS, once; Android keeps its release stubs', () => {
    // Android: fallback, nothing excluded (react-native-worklets' Gradle script needs expo-dev-launcher's Gradle plugin build)
    expect(gradle(gradle(settings, true), true)).toBe(settings);
    const p = podfile(podfile(pods, true), true);
    expect(p.match(/use_expo_modules!\(exclude: \['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'\]\)/g)).toHaveLength(1);
  });
  it('development over release folders: the exclude is taken out again', () => {
    expect(gradle(gradle(settings, true), false)).toBe(settings);
    expect(podfile(podfile(pods, true), false)).toBe(pods);
  });
});

describe('with-no-internet in development (v1.1)', () => {
  it('a development prebuild over preview folders puts INTERNET back and drops the remove marker', () => {
    const manifest = { manifest: { $: {}, 'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET', 'tools:node': 'remove' } }] } };
    const perms = withNoInternet({ manifest }, { remove: false }).modResults.manifest['uses-permission'] as { $: Record<string, string> }[];
    expect(perms).toEqual([{ $: { 'android:name': 'android.permission.INTERNET' } }]);
  });
});
