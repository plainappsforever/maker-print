// v1.1 (RELEASE_KIT 1c item 14): preview and production builds link no development client. `expo-dev-client` is a
// dependency of every variant; its Android release source set still compiled stubs (`expo/modules/devlauncher` in the
// preview APK's dex) and the iOS Release binary carried expo-dev-launcher / expo-dev-menu. Expo autolinking's own
// exclude list keeps them out: Gradle settings `expoAutolinking.exclude = [...]` before `useExpoModules()`, Podfile
// `use_expo_modules!(exclude: [...])`. Development keeps them (launchMode, dev menu). Idempotent both ways: prebuild runs
// without --clean (deletion rule), so a development prebuild over preview folders takes the exclude out again.
const { withPodfile, withSettingsGradle } = require('expo/config-plugins');

const MODULES = ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'];
// Android keeps all four (fallback, v1.1 L11 row): with expo-dev-launcher excluded, its Gradle plugin build is gone too and
// react-native-worklets' build.gradle.kts no longer compiles ("Unresolved reference 'JvmTarget' / 'spotless'", tried with all
// four and with launcher + client only; Print Cost found the same). Their Android release source sets are stubs
// (`disableInRelease`: DevLauncherPackageDelegate, ExpoDevLauncherModule, the dev-menu equivalents) — no launcher UI, no
// network code. `gradle()` keeps the mechanism (and removes an earlier exclude line) for when that is fixed upstream.
const ANDROID_MODULES = [];
const MARK = 'maker-print: release builds link no dev client (plugins/with-release-no-dev-client.js)';
const listOf = (ms) => ms.map((m) => `'${m}'`).join(', ');
const list = listOf(MODULES);

function gradle(src, exclude) {
  let out = src.replace(new RegExp(`// ${MARK.replace(/[().]/g, '\\$&')}\\n[^\\n]*\\n`, 'g'), '');
  if (exclude && ANDROID_MODULES.length) {
    if (!out.includes('expoAutolinking.useExpoModules()')) throw new Error('with-release-no-dev-client: settings.gradle layout not recognised');
    out = out.replace('expoAutolinking.useExpoModules()', `// ${MARK}\nexpoAutolinking.exclude = [${listOf(ANDROID_MODULES)}]\nexpoAutolinking.useExpoModules()`);
  }
  return out;
}

function podfile(src, exclude) {
  let out = src.replace(/use_expo_modules!\(exclude: \[[^\]]*\]\) # maker-print[^\n]*/g, 'use_expo_modules!');
  if (exclude) {
    if (!/^[ \t]*use_expo_modules![ \t]*$/m.test(out)) throw new Error('with-release-no-dev-client: Podfile layout not recognised');
    out = out.replace(/^([ \t]*)use_expo_modules![ \t]*$/m, `$1use_expo_modules!(exclude: [${list}]) # ${MARK}`);
  }
  return out;
}

module.exports = function withReleaseNoDevClient(config, { exclude } = { exclude: true }) {
  config = withSettingsGradle(config, (mod) => {
    mod.modResults.contents = gradle(mod.modResults.contents, exclude);
    return mod;
  });
  return withPodfile(config, (mod) => {
    mod.modResults.contents = podfile(mod.modResults.contents, exclude);
    return mod;
  });
};
module.exports.gradle = gradle;
module.exports.podfile = podfile;
module.exports.MODULES = MODULES;
module.exports.ANDROID_MODULES = ANDROID_MODULES;
