import fs from 'node:fs';
const G = await import(new URL('../../../src/', import.meta.url).pathname + 'engine/geometry.ts');
const cases = JSON.parse(fs.readFileSync('geo.json', 'utf8'));
let bad = 0, badB = 0, worst = 0;
for (const c of cases) {
  const q = G.apply(G.objectMatrix(c.p), { x: c.u, y: c.v });
  const d = Math.max(Math.abs(q.x - c.X), Math.abs(q.y - c.Y)); worst = Math.max(worst, d);
  if (d > 1e-9) bad++;
  const b = G.rotatedBounds(c.p);
  if ([b.x - c.bounds[0], b.y - c.bounds[1], b.w - c.bounds[2], b.h - c.bounds[3]].some((v) => Math.abs(v) > 1e-9)) badB++;
}
console.log('geometry cases', cases.length, 'point mismatches', bad, 'bounds mismatches', badB, 'worst', worst);
