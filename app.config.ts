import type { ConfigContext, ExpoConfig } from 'expo/config';

// One codebase, three installable variants that can sit side by side on a device.
// Select with APP_VARIANT (set by scripts/native.sh and eas.json).
const VARIANTS = {
  development: { name: 'Maker Print Dev', id: 'com.tim.makerprint.dev', scheme: 'makerprint-dev' },
  preview: { name: 'Maker Print Preview', id: 'com.tim.makerprint.preview', scheme: 'makerprint-preview' },
  production: { name: 'Maker Print', id: 'com.tim.makerprint', scheme: 'makerprint' },
} as const;

type Variant = keyof typeof VARIANTS;

const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
if (!(variant in VARIANTS)) {
  throw new Error(`Unknown APP_VARIANT "${variant}". Use development, preview or production.`);
}
const { name, id, scheme } = VARIANTS[variant];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'maker-print',
  version: '1.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: id,
    buildNumber: '10100',
    icon: './assets/expo.icon',
    // No encryption of our own (no network code; the OS does the printing), so App Store Connect stops asking at every
    // upload (P7, D82). The owner confirms the export-compliance answer once.
    config: { usesNonExemptEncryption: false },
    // v1.1 (RELEASE_KIT 1c item 16): expo-file-system's own privacy manifest does not reach the built app (its pod bundle
    // ExpoFileSystem_privacy.bundle holds only Info.plist, read from the Release .app), so its reasons are declared at app
    // level, next to the ones the template and the other pods declare. Merged by Expo into PrivacyInfo.xcprivacy.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'] },
      ],
    },
  },
  android: {
    package: id,
    versionCode: 10100,
    // No cloud/device backup of the database or the project files (same decision as the sibling apps, P7, D82): projects
    // can be exported as PDF; a restored phone starts clean instead of with half a backup.
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // expo-image-picker's library manifest asks for storage (API ≤ 32) and camera permissions; the photo picker needs
    // none (SPEC A10: no permission prompt anywhere, no dangerous permission). D67.
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      // Expo's template and libraries add these; the app draws no overlays, never vibrates and never asks for the network state
      // (P7: `aapt dump permissions` of the first preview APK listed them; 0 INTERNET already).
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
  },
  plugins: [
    // Listed first so its mods run last: preview/production carry no dev-client keys an earlier dev prebuild wrote
    // (prebuild runs without --clean). Ported from meter-tracker in P4.
    ...(variant === 'development' ? [] : ['./plugins/without-dev-client-residue.js' as const]),
    // Only this variant's URL scheme survives a prebuild over another variant's native folders.
    ['./plugins/with-own-scheme-only.js', { own: scheme, all: Object.values(VARIANTS).map((v) => v.scheme) }],
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#C62828', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-sqlite',
    // Library picking needs no permission (PHPicker / Android photo picker); no camera in v1 (V1_PLAN pinned additions).
    ['expo-image-picker', { photosPermission: false, cameraPermission: false, microphonePermission: false }],
    // Signing with the owner's upload key when keystore.properties exists (P7); otherwise the debug key, as before.
    './plugins/with-release-signing.js',
    // v1.1 (RELEASE_KIT 1c item 14): preview and production link no development client; development takes the exclude out again.
    ['./plugins/with-release-no-dev-client.js', { exclude: variant !== 'development' }],
    // A10/D14: preview and production carry no INTERNET permission (development needs it to reach Metro).
    // Applied to every variant: development puts INTERNET back after a preview prebuild (no --clean, v1.1).
    ['./plugins/with-no-internet.js', { remove: variant !== 'development' }],
    // Dev builds reopen the last Metro server directly, so Maestro can launch them unattended.
    ...(variant === 'development'
      ? [['expo-dev-client', { launchMode: 'most-recent' }] as [string, object], './plugins/with-dev-menu-defaults.js' as const]
      : []),
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appVariant: variant,
  },
});
