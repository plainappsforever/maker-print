import { FakeCamera, FakeNames } from '../../../test/fakes/capture';
import { en } from '@/i18n/en';
import { displayName } from '@/import/incoming';
import { translate } from '@/i18n/index';

import { cameraErrorKey, incomingErrorKey, scanErrorKey, scanWarningMessages } from './messages';

describe('scan / camera / open-in messages', () => {
  it('every code has a sentence in both languages', () => {
    const codes = ['notFinite', 'outside', 'degenerate', 'selfIntersecting', 'mirrored', 'concave', 'tooSmall', 'badLength', 'noShape', 'warpFailed', 'corrupt', 'tooManyPixels'] as const;
    for (const c of codes) {
      const key = scanErrorKey(c);
      expect(key in en).toBe(true);
      expect(translate('de', key)).not.toBe(translate('en', key));
    }
    expect(scanErrorKey('badLength')).toBe('scan.error.badLength');
    expect(scanErrorKey('corrupt')).toBe('import.error.corrupt');
    for (const e of ['dxfNotYet', 'archiveNotYet', 'unsupportedType', 'compressedTooLarge', 'compressedCorrupt'] as const) expect(incomingErrorKey(e) in en).toBe(true);
    expect(cameraErrorKey('cancelled', 'ios')).toBeNull();
    expect(cameraErrorKey('denied', 'ios')).toBe('capture.denied.ios');
    expect(cameraErrorKey('denied', 'android')).toBe('capture.denied.android');
    expect(cameraErrorKey('unavailable', 'android')).toBe('capture.unavailable');
    expect(cameraErrorKey('failed', 'ios')).toBe('capture.failed');
  });

  it('warnings carry their numbers', () => {
    const m = scanWarningMessages({ warnings: ['aspectMismatch', 'lowDetail', 'aspectEstimated'], sizeMm: { w: 297, h: 210 }, aspect: { ratio: 210 / 297, source: 'perspective', focalPx: 1, spread: 0 }, detailPpi: 87.4 });
    expect(m.map((x) => x.key)).toEqual(['scan.warn.aspectMismatch', 'scan.warn.lowDetail', 'scan.warn.aspectEstimated']);
    expect(m[0].params).toEqual({ pct: 100 });
    expect(translate('de', m[1].key, m[1].params)).toContain('87 Pixel');
  });

  it('review M2: `aspectWeak` names this photo’s own range (no fixed "up to 10 %"); N8: "about {pct} %"', () => {
    const aspect = { ratio: 0.7, source: 'assumedLens' as const, focalPx: 1, spread: 0, lensRange: { lo: 0.58, hi: 0.81 } };
    const [w] = scanWarningMessages({ warnings: ['aspectWeak'], sizeMm: { w: 210, h: 300 }, aspect, detailPpi: 300, estimatedRangeMm: { min: 258.4, max: 359.2 } });
    expect(w).toEqual({ key: 'scan.warn.aspectWeak', params: { min: '258 mm', max: '359 mm' } });
    for (const lang of ['en', 'de'] as const) {
      const text = translate(lang, w.key, w.params);
      expect(text).toContain('258 mm');
      expect(text).toContain('359 mm');
      expect(text).not.toMatch(/10 ?%/);
    }
    // the screen's own formatter (user's unit)
    expect(scanWarningMessages({ warnings: ['aspectWeak'], sizeMm: null, aspect, detailPpi: null, estimatedRangeMm: { min: 254, max: 508 } }, (mm) => `${mm / 25.4} in`)[0].params).toEqual({ min: '10 in', max: '20 in' });
    // straighten only: the shape's range in per cent (largest side of 0.58 … 0.81 around 0.7 → 18 %)
    expect(scanWarningMessages({ warnings: ['aspectWeak'], sizeMm: null, aspect, detailPpi: null })[0]).toEqual({ key: 'scan.warn.aspectWeakShape', params: { pct: 18 } });
    expect(scanWarningMessages({ warnings: ['aspectWeak'], sizeMm: null, aspect: { ...aspect, lensRange: null }, detailPpi: null })[0].key).toBe('scan.warn.aspectWeakUnknown');
    const mm = scanWarningMessages({ warnings: ['aspectMismatch'], sizeMm: { w: 210, h: 260 }, aspect: { ratio: 210 / 297, source: 'lens', focalPx: 1, spread: 0 }, detailPpi: 300 })[0];
    expect(translate('en', mm.key, mm.params)).toContain('about 14 % apart');
  });

  it('with the fakes: a denied camera says where to allow it; a resolved Android name replaces "34.jpg"', async () => {
    const r = await new FakeCamera({ ok: false, reason: 'denied' }).takePhoto();
    expect(!r.ok && translate('de', cameraErrorKey(r.reason, 'ios')!)).toContain('Einstellungen → Maker Print → Kamera');
    const uri = 'content://media/external/images/media/34';
    const names = new FakeNames({ [uri]: 'Halterung.jpg' });
    expect(displayName({ resolved: await names.displayName(uri), picked: '34.jpg', uri, kind: 'jpeg', fallbackStem: 'Foto' })).toBe('Halterung.jpg');
    expect(displayName({ resolved: await names.displayName('content://x/1'), picked: '1.jpg', kind: 'jpeg', fallbackStem: 'Foto 2026-10-16 12.30' })).toBe('Foto 2026-10-16 12.30.jpg');
  });
});
