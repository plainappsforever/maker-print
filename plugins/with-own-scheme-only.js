// Ported from meter-tracker (P4). `expo prebuild` without --clean (deletion rule) ADDS the URL scheme of the variant being prepared to the existing manifest/Info.plist
// but never removes the scheme an earlier prebuild of ANOTHER variant wrote. Found in meter-tracker V1 P6: its preview APK declared
// its dev scheme as well, so a dev link opened an "Open with Dev / Preview" chooser and stalled every Maestro flow. This plugin
// keeps only the current variant's scheme among the app's own schemes (Android VIEW intent filters, iOS CFBundleURLSchemes);
// other schemes (https, exp+… handled by without-dev-client-residue) are untouched. Registered for every variant.
const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('expo/config-plugins');

module.exports = function withOwnSchemeOnly(config, { own, all }) {
  const foreign = (s) => typeof s === 'string' && s !== own && all.includes(s);

  config = withInfoPlist(config, (mod) => {
    if (Array.isArray(mod.modResults.CFBundleURLTypes)) {
      mod.modResults.CFBundleURLTypes = mod.modResults.CFBundleURLTypes.map((t) => ({
        ...t,
        CFBundleURLSchemes: (t.CFBundleURLSchemes ?? []).filter((s) => !foreign(s)),
      })).filter((t) => t.CFBundleURLSchemes.length > 0);
    }
    return mod;
  });

  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    for (const activity of app.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        if (filter.data) filter.data = filter.data.filter((d) => !foreign(d.$?.['android:scheme']));
      }
      activity['intent-filter'] = (activity['intent-filter'] ?? []).filter((f) => !(f.data && f.data.length === 0 && JSON.stringify(f.category ?? []).includes('BROWSABLE')));
    }
    return mod;
  });
};
