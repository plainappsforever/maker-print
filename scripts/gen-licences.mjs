// v1.1 (RELEASE_KIT 1c item 15): the open-source notices shown in Privacy & about → Open-source licences.
// Which packages ship: every package whose files are in the release JS bundles (source maps of `expo export` for iOS
// and Android, production variant) plus every autolinked native package (Expo modules and React Native libraries),
// minus the development client (not linked in release builds, plugins/with-release-no-dev-client.js) and our own module.
// For each: name, version, licence id from its package.json, and the text of its LICENSE / LICENCE / COPYING file
// (identical texts stored once). Native libraries that React Native itself builds in (Hermes, Yoga, folly, …) are listed
// by hand in NATIVE below. Output: src/lib/licences.generated.ts. Nothing is deleted: each run exports into a new folder
// artifacts/licences/export-<time>.
// Usage: node scripts/gen-licences.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, APP_VARIANT: 'production', CI: '1' };
// GEN_LICENCES_EXPORT=<folder> reuses an earlier export of this script
const out = process.env.GEN_LICENCES_EXPORT ? path.resolve(process.env.GEN_LICENCES_EXPORT) : path.join(ROOT, 'artifacts/licences', `export-${new Date().toISOString().replace(/[:.]/g, '-')}`);
if (!process.env.GEN_LICENCES_EXPORT) {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('npx', ['expo', 'export', '--platform', 'ios', '--platform', 'android', '--source-maps', '--output-dir', out], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
}

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));
const pkgDirs = new Set();
for (const map of walk(out).filter((f) => f.endsWith('.map'))) {
  for (const src of JSON.parse(readFileSync(map, 'utf8')).sources ?? []) {
    const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(src.split('node_modules/').length > 2 ? src.slice(src.lastIndexOf('node_modules/')) : src);
    if (m) pkgDirs.add(m[1]);
  }
}
const jsCount = pkgDirs.size;
const autolink = (platform) => JSON.parse(execFileSync('npx', ['expo-modules-autolinking', 'resolve', '--platform', platform, '--json'], { cwd: ROOT, env }).toString()).modules.map((m) => m.packageName);
const rnConfig = (platform) => Object.keys(JSON.parse(execFileSync('node', ['--no-warnings', '--eval', "require('expo/bin/autolinking')", 'expo-modules-autolinking', 'react-native-config', '--json', '--platform', platform], { cwd: ROOT, env }).toString()).dependencies ?? {});
const SKIP = new Set(['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface', 'maker-print-native']);
for (const p of ['ios', 'android']) for (const n of [...autolink(p), ...rnConfig(p), 'react-native']) if (!SKIP.has(n)) pkgDirs.add(n);
for (const n of SKIP) pkgDirs.delete(n);

const licenceText = (dir) => {
  const file = existsSync(dir) ? readdirSync(dir).find((f) => LICENCE_FILE.test(f)) : undefined;
  return file ? readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim() : '';
};
// packages published without a licence file: the text of the project they come from (same copyright holder)
const familyText = (name) =>
  name.startsWith('@react-native/') ? licenceText(path.join(ROOT, 'node_modules/react-native')) : /^(@expo\/|expo-)/.test(name) ? licenceText(path.join(ROOT, 'node_modules/expo')) : '';
// else the standard MIT text with the author named in package.json
const mitText = (id, pj) => {
  if (id !== 'MIT') return '';
  const who = typeof pj.author === 'string' ? pj.author : pj.author?.name ?? `the ${pj.name} authors`;
  return `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
};
const texts = [];
const textIndex = new Map();
const rows = [];
const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;
for (const name of [...pkgDirs].sort()) {
  const dir = path.join(ROOT, 'node_modules', name);
  if (!existsSync(path.join(dir, 'package.json'))) continue;
  const pj = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const id = typeof pj.license === 'string' ? pj.license : pj.license?.type ?? (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(' OR ') : 'see text');
  const text = licenceText(dir) || familyText(name) || mitText(id, pj);
  let ti = -1;
  if (text) {
    if (!textIndex.has(text)) {
      textIndex.set(text, texts.length);
      texts.push(text);
    }
    ti = textIndex.get(text);
  }
  rows.push([name, pj.version ?? '', id, ti]);
}

// Built into the app by React Native / the platforms (not npm packages of their own). Texts: the licence ids' standard texts
// are not reproduced here; the copyright holders and licences are named.
const NATIVE = [
  ['Hermes JavaScript engine (Meta)', 'MIT'],
  ['Yoga layout (Meta)', 'MIT'],
  ['folly (Meta)', 'Apache-2.0'],
  ['fbjni, SoLoader (Meta, Android)', 'Apache-2.0'],
  ['Fresco image pipeline (Meta, Android)', 'MIT'],
  ['OkHttp, Okio (Square, Android)', 'Apache-2.0'],
  ['AndroidX / Jetpack libraries (Google, Android)', 'Apache-2.0'],
  ['Kotlin standard library and coroutines (JetBrains, Android)', 'Apache-2.0'],
  ['glog, double-conversion (Google)', 'BSD-3-Clause'],
  ['Boost (iOS/Android native build)', 'BSL-1.0'],
  ['fmt', 'MIT'],
  ['SQLite (bundled by expo-sqlite)', 'Public domain'],
];

const body = `// GENERATED by scripts/gen-licences.mjs on ${new Date().toISOString().slice(0, 10)} — do not edit by hand.
// ${rows.length} packages (${jsCount} from the release JS bundles + autolinked native packages), ${texts.length} distinct licence texts.
/** [package, version, licence id, index into LICENCE_TEXTS or -1] */
export const LICENCES: readonly (readonly [string, string, string, number])[] = ${JSON.stringify(rows)};
export const LICENCE_TEXTS: readonly string[] = ${JSON.stringify(texts)};
/** [component, licence id] */
export const NATIVE_COMPONENTS: readonly (readonly [string, string])[] = ${JSON.stringify(NATIVE)};
`;
writeFileSync(path.join(ROOT, 'src/lib/licences.generated.ts'), body);
console.log(`wrote src/lib/licences.generated.ts: ${rows.length} packages (${jsCount} in the JS bundles), ${texts.length} texts, ${Math.round(body.length / 1024)} KB; export in ${path.relative(ROOT, out)}`);
