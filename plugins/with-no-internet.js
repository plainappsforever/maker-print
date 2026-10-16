// Removes android.permission.INTERNET from the Android manifest (D14). Applied to preview and
// production only: development builds need it to reach Metro. Release JS is embedded and the app
// uses no network; links open in the browser, which is another app with its own permission.
// Two parts: drop the permission Expo's prebuild template declares in the app manifest, and add a
// tools:node="remove" marker so a library manifest cannot bring it back during the manifest merge.
const { withAndroidManifest } = require('expo/config-plugins');

const INTERNET = 'android.permission.INTERNET';

// v1.1: applied to EVERY variant with `remove` = variant !== 'development'. prebuild runs without --clean (deletion rule),
// so a development prebuild over preview folders must put INTERNET back (found in v1.1: the dev build crashed at start,
// "NsdService: … has no android.permission.INTERNET").
module.exports = function withNoInternet(config, { remove } = { remove: true }) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const others = (manifest['uses-permission'] ?? []).filter((p) => p.$['android:name'] !== INTERNET);
    if (remove) {
      manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
      others.push({ $: { 'android:name': INTERNET, 'tools:node': 'remove' } });
    } else {
      others.unshift({ $: { 'android:name': INTERNET } });
    }
    manifest['uses-permission'] = others;
    return mod;
  });
};
