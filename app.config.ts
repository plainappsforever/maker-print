import type { ConfigContext, ExpoConfig } from 'expo/config';

import brand from './src/constants/brand.json';

// One codebase, three installable variants that can sit side by side on a device.
// Select with APP_VARIANT (set by scripts/native.sh and eas.json).
// Bundle ids follow the owner's rule of 2026-10-16: com.plainapps.<app>, never a personal name. Production is registered at Apple.
const ID_PREFIX = 'com.plainapps';
const VARIANTS = {
  development: { name: 'Maker Print Dev', id: `${ID_PREFIX}.makerprint.dev`, scheme: 'makerprint-dev' },
  preview: { name: 'Maker Print Preview', id: `${ID_PREFIX}.makerprint.preview`, scheme: 'makerprint-preview' },
  production: { name: 'Maker Print', id: `${ID_PREFIX}.makerprint`, scheme: 'makerprint' },
} as const;

type Variant = keyof typeof VARIANTS;

// A Release build of Xcode (expo-constants' app-config phase runs this file with CONFIGURATION=Release) without APP_VARIANT would
// embed the DEVELOPMENT config in an App Store binary. Refuse instead of defaulting; scripts/check-variant.sh reads it back.
if (process.env.APP_VARIANT === undefined && /^release/i.test(process.env.CONFIGURATION ?? '')) {
  throw new Error('APP_VARIANT is not set in a Release build. Prefix the command with APP_VARIANT=production (or preview), see docs/RELEASE_KIT.md.');
}
const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
if (!(variant in VARIANTS)) {
  throw new Error(`Unknown APP_VARIANT "${variant}". Use development, preview or production.`);
}
const { name, id, scheme } = VARIANTS[variant];

// D24: splash and Android icon background come from the app's identity file (src/constants/brand.json), never a literal here.
const IDENTITY = {
  splash: { light: brand.light.background, dark: brand.dark.background },
  iconBackground: brand.light.accent,
};

// Apple Developer team for signing: only from the environment (APPLE_TEAM_ID is not a secret, but it is not committed either).
const appleTeamId = process.env.APPLE_TEAM_ID || undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'maker-print',
  version: '1.2.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: id,
    ...(appleTeamId ? { appleTeamId } : {}),
    buildNumber: '10200',
    icon: { light: './assets/images/icon.png', dark: './assets/images/icon-dark.png', tinted: './assets/images/icon-tinted.png' },
    // No encryption of our own (no network code; the OS does the printing), so App Store Connect stops asking at every
    // upload (P7, D82). Owner's standing approval ANSWERS.md 2026-11-07: no own crypto -> ITSAppUsesNonExemptEncryption false,
    // all territories (the PDF library only opens a user-picked file whose user password is empty; it never encrypts).
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
    versionCode: 10200,
    // No cloud/device backup of the database or the project files (same decision as the sibling apps, P7, D82): projects
    // can be exported as PDF; a restored phone starts clean instead of with half a backup.
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#6A1B9A',
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
    // Xcode 27 / iOS 27 traps at launch without scene support (starter D9); keep until SDK 58.
    ['expo-build-properties', { ios: { enableSceneSupport: true } }],
    ['expo-splash-screen', { backgroundColor: IDENTITY.splash.light, dark: { backgroundColor: IDENTITY.splash.dark }, image: './assets/images/splash-icon.png', imageWidth: 76 }],
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
