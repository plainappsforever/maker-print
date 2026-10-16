import fs from 'node:fs';
const { inspectAsset } = await import(new URL('../../src/import/assets.ts', import.meta.url).pathname);
for (const f of ['e01-latin1.svg', 'e02-utf16.svg', 'e03-utf8-bom.svg', 'e04-svgz.svgz']) {
  const r = await inspectAsset('svg', new Uint8Array(fs.readFileSync('svg/' + f)));
  console.log(f, r.ok ? 'ok ' + JSON.stringify(r.asset.report.issues) + ' drawn ' + r.asset.report.drawn : 'REFUSED ' + r.error);
}
