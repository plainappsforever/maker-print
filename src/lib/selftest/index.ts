// Engine self-test on the device's JS engine (V1_PLAN P4 step 3): W1–W10, every referee fixture project written to PDF
// on Hermes and compared with Node's output (geometry hash: decoded objects, numbers to 1e-6 pt; byte identity reported)
// — which the referee measured with CoreGraphics — the
// import fixtures' natural sizes, and the native rasteriser on three written PDFs. "SELFTEST OK n/n" when all pass.
import native from '../../../modules/maker-print-native';
import { inspectAsset, planAssetOf } from '../../import/assets';
import { writeOutputPdf } from '../files';

import { EXPECTED, FILES, IMPORTS, PROJECTS } from './fixtures.generated';
import { base64ToBytes, fixtureProjectPdf, geometryHash, hashBytes, type FixtureProject } from './project-pdf';
import { workedExampleChecks, type Check } from './worked';

export type { Check };
export const RASTER_PROJECTS = ['09-calibration-a4', '08-ruler-w4', '14-letter-turned-assets'];

const files = new Map<string, Uint8Array>();
export const fixtureFile = (p: string) => {
  let b = files.get(p);
  if (!b) {
    b = base64ToBytes(FILES[p]);
    files.set(p, b);
  }
  return b;
};

/** Writes one referee fixture project to cache/print/<name>.pdf on this device; returns its URI and page facts. */
export async function writeFixturePdf(name: string) {
  const f = PROJECTS.find((p: FixtureProject) => p.name === name) as FixtureProject | undefined;
  if (!f) throw new Error(`no fixture ${name}`);
  const r = await fixtureProjectPdf(f, fixtureFile);
  const uri = writeOutputPdf(`${name}.pdf`, r.bytes);
  return { uri, plan: r.plan, bytes: r.bytes };
}

export async function runSelfTest(onProgress?: (done: number) => void): Promise<{ checks: Check[]; ms: number }> {
  const t0 = Date.now();
  const checks: Check[] = [...workedExampleChecks()];
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  onProgress?.(checks.length);

  for (const f of PROJECTS as FixtureProject[]) {
    try {
      const t = Date.now();
      const r = await fixtureProjectPdf(f, fixtureFile);
      const hash = hashBytes(r.bytes);
      const want = EXPECTED[f.name];
      const ms = Date.now() - t;
      const geometry = await geometryHash(r.bytes);
      checks.push({
        name: `PDF ${f.name} = Node geometry`,
        ok: geometry === want.geometry && r.plan.pages.length === want.pages && r.notes === want.notes,
        detail: `${hash === want.hash ? 'bytes identical' : 'bytes differ (libm last bit)'}, ${ms} ms`,
      });
      if (RASTER_PROJECTS.includes(f.name)) {
        const uri = writeOutputPdf(`${f.name}.pdf`, r.bytes);
        if (!native) checks.push({ name: `raster ${f.name}`, ok: false, detail: 'native module missing' });
        else {
          const page = r.plan.pages[0];
          const img = await native.renderPdfPage(uri, 0, 1000);
          const want = page.widthMm / page.heightMm;
          checks.push({ name: `raster ${f.name}`, ok: Math.abs(img.widthPx / img.heightPx - want) < 0.01 && Math.max(img.widthPx, img.heightPx) === 1000, detail: `${img.widthPx}×${img.heightPx}` });
        }
      }
    } catch (e) {
      checks.push({ name: `PDF ${f.name}`, ok: false, detail: String((e as Error)?.message ?? e) });
    }
    onProgress?.(checks.length);
    await tick();
  }

  for (const [rel, want] of Object.entries(IMPORTS)) {
    try {
      const r = await inspectAsset(want.kind, fixtureFile(rel));
      const got = r.ok ? { ok: true, kind: want.kind, plan: planAssetOf({ id: 1, kind: want.kind, pxW: r.asset.pxW, pxH: r.asset.pxH, svgPxPerIn: null, report: r.asset.report }) } : { ok: false, kind: want.kind, error: r.error };
      checks.push({ name: `import ${rel} = Node`, ok: JSON.stringify(got) === JSON.stringify(want), detail: JSON.stringify(got).slice(0, 120) });
    } catch (e) {
      checks.push({ name: `import ${rel}`, ok: false, detail: String((e as Error)?.message ?? e) });
    }
  }
  onProgress?.(checks.length);
  return { checks, ms: Date.now() - t0 };
}
