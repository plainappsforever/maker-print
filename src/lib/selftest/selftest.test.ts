/**
 * @jest-environment node
 */
// The on-device self-test's own pieces, run in Node: the W1–W10 checks pass, and the bundled fixtures still produce
// exactly the bytes recorded in fixtures.generated.ts. If this fails after an engine/writer change, regenerate the bundle
// (`npm run referee`, then node --import ./scripts/referee/register.mjs scripts/fixtures/make-selftest-bundle.mjs).
import { inspectAsset, planAssetOf } from '@/import/assets';

import { EXPECTED, FILES, IMPORTS, PROJECTS } from './fixtures.generated';
import { base64ToBytes, fixtureProjectPdf, geometryHash, hashBytes, type FixtureProject } from './project-pdf';
import { workedExampleChecks } from './worked';

const file = (p: string) => base64ToBytes(FILES[p]);

describe('self-test pieces in Node', () => {
  it('W1–W10 checks all pass', () => {
    const failed = workedExampleChecks().filter((c) => !c.ok);
    expect(failed).toEqual([]);
  });

  it.each((PROJECTS as FixtureProject[]).map((p) => p.name))('%s writes the recorded bytes', async (name) => {
    const f = (PROJECTS as FixtureProject[]).find((p) => p.name === name)!;
    const r = await fixtureProjectPdf(f, file);
    expect({ hash: hashBytes(r.bytes), geometry: await geometryHash(r.bytes), pages: r.plan.pages.length, notes: r.notes }).toEqual(EXPECTED[name]);
  });

  it.each(Object.keys(IMPORTS))('import %s matches the recorded result', async (rel) => {
    const want = IMPORTS[rel];
    const r = await inspectAsset(want.kind, file(rel));
    const got = r.ok ? { ok: true, kind: want.kind, plan: planAssetOf({ id: 1, kind: want.kind, pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: null, report: r.asset.report }) } : { ok: false, kind: want.kind, error: r.error };
    expect(got).toEqual(want);
  });

  it('geometryHash ignores last-bit float noise but not a real change', async () => {
    const f = (PROJECTS as FixtureProject[]).find((p) => p.name === '09-calibration-a4')!;
    const r = await fixtureProjectPdf(f, file);
    const text = Array.from(r.bytes, (b) => String.fromCharCode(b)).join('');
    expect(await geometryHash(r.bytes)).toBe(EXPECTED[f.name].geometry);
    // the page size is an uncompressed number in the page dict: nudge it by 1e-12 pt (noise) and by 0.01 pt (real)
    const nudge = (to: string) => Uint8Array.from(text.replace('841.8897637795276', to), (c) => c.charCodeAt(0));
    expect(text.includes('841.8897637795276')).toBe(true);
    expect(await geometryHash(nudge('841.8897637795286'))).toBe(EXPECTED[f.name].geometry);
    expect(await geometryHash(nudge('841.8997637795276'))).not.toBe(EXPECTED[f.name].geometry);
  });

  it('hashBytes tells different bytes apart and is stable', () => {
    expect(hashBytes(new Uint8Array([1, 2, 3]))).toBe(hashBytes(new Uint8Array([1, 2, 3])));
    expect(hashBytes(new Uint8Array([1, 2, 3]))).not.toBe(hashBytes(new Uint8Array([1, 2, 4])));
  });
});
