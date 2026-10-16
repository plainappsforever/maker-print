// Ported from meter-tracker (P4). Preview/production builds carry no development-client residue (invoice-maker D90 pattern). expo-dev-client's
// own plugin and with-dev-menu-defaults write keys for every variant, and `expo prebuild` without --clean (deletion rule)
// keeps keys an earlier development prebuild wrote, so this plugin REMOVES them actively:
// iOS: EXDevMenu* keys, NSLocalNetworkUsageDescription, the _expo._tcp Bonjour service, NSAllowsLocalNetworking and the
// exp+<slug> URL scheme. Android: EXDevMenu* and expo.modules.updates.* meta-data and the exp+<slug> VIEW scheme.
// Applied to preview/production only and listed FIRST in app.config.ts, so its mods run after the others.
const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('expo/config-plugins');

const isDevScheme = (s) => typeof s === 'string' && s.startsWith('exp+');

module.exports = function withoutDevClientResidue(config) {
  config = withInfoPlist(config, (mod) => {
    const plist = mod.modResults;
    for (const key of Object.keys(plist)) if (key.startsWith('EXDevMenu')) delete plist[key];
    delete plist.NSLocalNetworkUsageDescription;
    const bonjour = (plist.NSBonjourServices ?? []).filter((s) => s !== '_expo._tcp');
    if (bonjour.length > 0) plist.NSBonjourServices = bonjour;
    else delete plist.NSBonjourServices;
    if (plist.NSAppTransportSecurity) {
      delete plist.NSAppTransportSecurity.NSAllowsLocalNetworking;
      if (Object.keys(plist.NSAppTransportSecurity).every((k) => k === 'NSAllowsArbitraryLoads' && plist.NSAppTransportSecurity[k] === false)) {
        delete plist.NSAppTransportSecurity;
      }
    }
    if (Array.isArray(plist.CFBundleURLTypes)) {
      plist.CFBundleURLTypes = plist.CFBundleURLTypes.map((t) => ({ ...t, CFBundleURLSchemes: (t.CFBundleURLSchemes ?? []).filter((s) => !isDevScheme(s)) })).filter(
        (t) => t.CFBundleURLSchemes.length > 0
      );
    }
    return mod;
  });

  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => {
      const name = m.$?.['android:name'] ?? '';
      return !name.startsWith('EXDevMenu') && !name.startsWith('expo.modules.updates.');
    });
    for (const activity of app.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        if (filter.data) filter.data = filter.data.filter((d) => !isDevScheme(d.$?.['android:scheme']));
      }
    }
    return mod;
  });
};
