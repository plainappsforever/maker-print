// P7, D82: Android release builds are signed with the owner's upload key when the git-ignored
// file `keystore.properties` exists next to package.json (storeFile, storePassword, keyAlias, keyPassword; storeFile is
// relative to that file). Without it the release build stays signed with the debug key, exactly as before, and Gradle
// prints a warning — so preview builds keep working on any Mac. Claude never creates, sees or commits the key: the
// owner runs the one `keytool` line in MORNING_REPORT.md and writes the four values.
// Idempotent: `expo prebuild` without --clean re-applies mods to the existing build.gradle (deletion rule).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// maker-print: release signing (plugins/with-release-signing.js)';

const SIGNING = `
        ${MARK}
        release {
            def ksFile = rootProject.file('../keystore.properties')
            if (ksFile.exists()) {
                def ks = new Properties()
                ksFile.withInputStream { ks.load(it) }
                storeFile new File(ksFile.parentFile, ks['storeFile'])
                storePassword ks['storePassword']
                keyAlias ks['keyAlias']
                keyPassword ks['keyPassword']
            }
        }`;

const USE = `signingConfig rootProject.file('../keystore.properties').exists() ? signingConfigs.release : signingConfigs.debug
            if (!rootProject.file('../keystore.properties').exists()) logger.warn('maker-print: keystore.properties not found - release build signed with the DEBUG key (not uploadable)')`;

function apply(src) {
  if (src.includes(MARK)) return src;
  let out = src.replace(/signingConfigs \{\n(\s*)debug \{([\s\S]*?)\n\s*\}\n/, (m) => m.replace(/\n(\s*)\}\n$/, `\n$1}${SIGNING}\n`));
  // The template's release build type: replace its debug signing line (the first one after "release {" in buildTypes).
  out = out.replace(/(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/, `$1${USE}`);
  if (!out.includes(MARK) || !out.includes('signingConfigs.release')) throw new Error('with-release-signing: build.gradle layout not recognised');
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = apply(mod.modResults.contents);
    return mod;
  });
};
module.exports.apply = apply;
