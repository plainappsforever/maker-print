/**
 * @jest-environment node
 */
import { cosSinDeg, rotatedBounds } from '@/engine/geometry';
import { paperSize, uniformMargins } from '@/engine/paper';
import { printTranslator } from '@/i18n';

import { Autosave } from './autosave';
import { fileKind } from './filekind';
import { cornerPoints, containsPoint, hitHandle, hitObject, moveBox, resizeBox, rotateBox, snapContextFor } from './gestures';
import { ppiOf, scaleOf } from './info';
import { planProject, planSummary, sheetTiles, effectiveMargins, type ProjectDoc } from './output';
import { centreOn, photoStartSize, sheetForImport } from './place';
import { defaultTemplateParams, templateProject } from './templates';
import { fitView, toMm, toScreen, zoomAbout } from './view';

const M = uniformMargins(6.35);
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const box = (x: number, y: number, w: number, h: number, rotationDeg = 0) => ({ x, y, w, h, rotationDeg });

describe('view', () => {
  it('fits the sheet, maps both ways and zooms about the focal point', () => {
    const v = fitView({ w: 210, h: 297 }, { w: 400, h: 600 }, 16);
    close(v.scale, Math.min(368 / 210, 568 / 297));
    const p = { x: 100, y: 50 };
    const s = toScreen(v, p);
    const back = toMm(v, s);
    close(back.x, 100);
    close(back.y, 50);
    const z = zoomAbout(v, 2, s);
    const again = toMm(z, s);
    close(again.x, 100);
    close(again.y, 50);
  });
});

describe('gestures', () => {
  it('hits the topmost visible unlocked object, inside its rotated box', () => {
    const items = [
      { id: 1, ...box(0, 0, 100, 100) },
      { id: 2, ...box(40, 40, 20, 20), locked: true },
      { id: 3, ...box(10, 45, 80, 10, 90) },
    ];
    expect(hitObject(items, { x: 50, y: 15 })?.id).toBe(3); // rotated 90°: the box now spans y 10…90
    expect(hitObject(items, { x: 20, y: 50 })?.id).toBe(1);
    expect(containsPoint(items[2], { x: 20, y: 50 })).toBe(false);
  });

  it('moves with snapping to the sheet centre and reports the guide', () => {
    const snap = snapContextFor({ w: 210, h: 297 }, M, [], 2, undefined); // 8 pt = 4 mm
    const r = moveBox(box(0, 0, 50, 30), 82, 0, snap); // centre at 107 → snaps to 105
    close(r.x, 80);
    expect(r.guides).toEqual([{ axis: 'x', at: 105, kind: 'sheet' }, { axis: 'y', at: 0, kind: 'sheet' }]);
  });

  it('resizes from a corner keeping the opposite corner, aspect locked', () => {
    const start = box(10, 10, 40, 30);
    const r = resizeBox(start, 'br', { x: 90, y: 70 }, true);
    close(r.x, 10);
    close(r.y, 10);
    close(r.w / r.h, 40 / 30, 1e-12);
    const free = resizeBox(start, 'tl', { x: 0, y: 5 }, false);
    expect(free).toMatchObject({ x: 0, y: 5, w: 50, h: 35 });
  });

  it('resizes a rotated box about its fixed opposite corner', () => {
    const start = box(50, 50, 40, 20, 30);
    const anchor = cornerPoints(start).tl;
    const [c, sn] = cosSinDeg(30);
    const target = { x: anchor.x + c * 60 - sn * 30, y: anchor.y + sn * 60 + c * 30 }; // br of a 60 × 30 box with the same tl
    const r = resizeBox(start, 'br', target, false);
    close(r.w, 60, 1e-9);
    close(r.h, 30, 1e-9);
    const tl = cornerPoints({ ...start, ...r }).tl;
    close(tl.x, anchor.x, 1e-9);
    close(tl.y, anchor.y, 1e-9);
  });

  it('rotates by the pointer turn and snaps to 15° steps nearby', () => {
    const start = box(0, 0, 20, 20);
    expect(rotateBox(start, { x: 10, y: -10 }, { x: 30, y: 10 })).toBe(90);
    expect(rotateBox(start, { x: 10, y: -10 }, { x: 10 + 20 * Math.sin(0.35), y: 10 - 20 * Math.cos(0.35) })).toBe(20.1);
    expect(rotateBox(start, { x: 10, y: -10 }, { x: 10 + 20 * Math.sin(0.2), y: 10 - 20 * Math.cos(0.2) })).toBe(15);
  });

  it('finds corner and rotation handles', () => {
    const b = box(0, 0, 50, 30);
    expect(hitHandle(b, { x: 49, y: 29 }, 5, 10)).toEqual({ kind: 'corner', corner: 'br' });
    expect(hitHandle(b, { x: 25, y: -10 }, 5, 10)).toEqual({ kind: 'rotate' });
    expect(hitHandle(b, { x: 25, y: 15 }, 5, 10)).toBeNull();
  });
});

describe('placement', () => {
  it('U1: a 1-page A2 PDF becomes a 420 × 594 sheet with the page at 100 % at the origin', () => {
    expect(sheetForImport({ w: 420, h: 594 }, 'a4', M)).toEqual({ sheet: { widthMm: 420, heightMm: 594, paperKey: 'a2' }, box: { x: 0, y: 0, w: 420, h: 594 } });
  });
  it('a small drawing goes centred on the output paper; a wide one on landscape paper; a huge one on its own sheet', () => {
    const small = sheetForImport({ w: 100, h: 60 }, 'a4', M);
    expect(small.sheet).toEqual({ widthMm: 210, heightMm: 297, paperKey: 'a4' });
    expect(small.box).toEqual({ x: 55, y: 118.5, w: 100, h: 60 });
    expect(sheetForImport({ w: 250, h: 150 }, 'a4', M).sheet).toEqual({ widthMm: 297, heightMm: 210, paperKey: 'a4' });
    expect(sheetForImport({ w: 5000, h: 100 }, 'a4', M).sheet).toEqual({ widthMm: 3000, heightMm: 100, paperKey: null });
  });
  it('photos: declared size, else the PPI target fitted into the safe area', () => {
    expect(photoStartSize({ w: 4032, h: 3024 }, null, 300, { w: 197.3, h: 284.3 })).toEqual({ w: 197.3, h: expect.any(Number) });
    close(photoStartSize({ w: 600, h: 300 }, null, 300, { w: 197.3, h: 284.3 }).w, 50.8);
    expect(photoStartSize({ w: 600, h: 300 }, { w: 300, h: 150 }, 300, { w: 197.3, h: 284.3 })).toEqual({ w: 300, h: 150 });
    expect(centreOn({ widthMm: 210, heightMm: 297 }, { w: 10, h: 20 })).toEqual({ x: 100, y: 138.5, w: 10, h: 20 });
  });
});

describe('templates', () => {
  it('U5: a 1 m ruler gets a 1000 × 30 sheet → 4 landscape A4 tiles + map (W4)', () => {
    const p = { ...defaultTemplateParams('ruler', 'a4', 'mm'), lengthMm: 1000 };
    const t = templateProject('ruler', p, M);
    expect(t.sheet).toEqual({ widthMm: 1000, heightMm: 30, paperKey: null });
    const { layout } = sheetTiles({ widthMm: 1000, heightMm: 30 }, { paperKey: 'a4', orientation: 'auto', overlapMm: 10 }, M);
    expect(layout).toMatchObject({ mode: 'tiled', orientation: 'landscape', cols: 4, rows: 1 });
  });
  it('U4: graph paper 5 mm, bold every 10 mm, covers the Letter safe area', () => {
    const p = { ...defaultTemplateParams('grid', 'letter', 'mm') };
    const t = templateProject('grid', p, M);
    expect(t.sheet).toEqual({ widthMm: 215.9, heightMm: 279.4, paperKey: 'letter' });
    expect(t.object).toMatchObject({ kind: 'grid', x: 6.35, y: 6.35, props: { spacingMm: 5, boldEvery: 2 } });
    close(t.object.w, 203.2);
  });
});

describe('autosave', () => {
  it('merges patches per object and writes once after the quiet time, or at flush', async () => {
    jest.useFakeTimers();
    const writes: [number, object][] = [];
    const a = new Autosave(async (id, p) => void writes.push([id, p]), 250);
    a.schedule(1, { x: 1 });
    a.schedule(1, { x: 2, y: 3 });
    a.schedule(2, { w: 5 });
    jest.advanceTimersByTime(200);
    expect(writes).toEqual([]);
    a.schedule(1, { y: 4 });
    jest.advanceTimersByTime(250);
    await a.flush(); // nothing pending: waits for the timer's writes
    expect(writes).toEqual([[1, { x: 2, y: 4 }], [2, { w: 5 }]]);
    a.schedule(3, { h: 1 });
    a.forget(3);
    a.schedule(4, { h: 2 });
    await a.flush();
    expect(writes.at(-1)).toEqual([4, { h: 2 }]);
    jest.useRealTimers();
  });
});

describe('file kinds', () => {
  const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  it('sniffs the content before trusting the name', () => {
    expect(fileKind(bytes('%PDF-1.7 xxxxxxxx'), 'x.svg')).toEqual({ kind: 'pdf', convert: false });
    expect(fileKind(bytes('\xff\xd8\xff\xe0xxxxxxxxxxxx'), 'a')).toEqual({ kind: 'image', convert: false });
    expect(fileKind(bytes('\0\0\0\x18ftypheicxxxx'), 'IMG.HEIC')).toEqual({ kind: 'image', convert: true });
    expect(fileKind(bytes('<?xml version="1.0"?>'), 'drawing')).toEqual({ kind: 'svg', convert: false });
    expect(fileKind(bytes('hello world 12345'), 'notes.txt')).toBeNull();
  });
});

describe('inspector info', () => {
  it('W2: a 4032 × 3024 photo at 40 mm wide is 2560.3 PPI, Sharp', () => {
    const r = ppiOf({ w: 40, h: 30, crop: null, fit: 'fill' }, { w: 4032, h: 3024 }, 300);
    close(r.ppi, 2560.32, 1e-9);
    expect(r.band).toBe('sharp');
  });
  it('a vector file at its natural size is 100 % and designed size', () => {
    expect(scaleOf({ w: 420, h: 594, crop: null, fit: 'fill' }, { w: 420, h: 594 })).toEqual({ x: 100, y: 100, designed: true });
    expect(scaleOf({ w: 210, h: 297, crop: null, fit: 'fill' }, { w: 420, h: 594 }).designed).toBe(false);
  });
});

describe('output', () => {
  const ctx = { locale: 'en' as const, unit: 'mm' as const, inchStyle: 'fraction16' as const, t: printTranslator('en') };
  const project = {
    id: 1, name: 'p', paperKey: 'a4' as const, orientation: 'auto' as const, marginMm: null, overlapMm: 10, marks: 'registration' as const,
    pageLabels: true, assemblyMap: 'auto' as const, skipBlank: true, excludedTiles: [], checkBar: null, profileId: null, thumbnailPath: null, createdAt: 0, updatedAt: 0,
  };
  const settings = { defaultMarginMm: 6.35, checkBar: true, ppiTarget: 300 as const };
  it('margins: project, else learned profile, else settings', () => {
    expect(effectiveMargins(project, null, settings)).toEqual(M);
    expect(effectiveMargins(project, { margins: { l: 3, t: 4, r: 5, b: 6 } }, settings)).toEqual({ l: 3, t: 4, r: 5, b: 6 });
    expect(effectiveMargins({ ...project, marginMm: 10 }, { margins: { l: 3, t: 4, r: 5, b: 6 } }, settings)).toEqual(uniformMargins(10));
    // D76: learned margins below 3 mm (a printer reporting 0 mm) keep 3 mm blank; typed margins are used as typed
    expect(effectiveMargins(project, { margins: { l: 0, t: 0, r: 2.5, b: 12 }, marginsSource: 'learned' }, settings)).toEqual({ l: 3, t: 3, r: 3, b: 12 });
    expect(effectiveMargins(project, { margins: { l: 0, t: 0, r: 2.5, b: 12 }, marginsSource: 'typed' }, settings)).toEqual({ l: 0, t: 0, r: 2.5, b: 12 });
  });
  it('U1 plan: an A2 sheet filled by a rectangle → 8 landscape A4 tiles + assembly map', () => {
    const doc: ProjectDoc = {
      project,
      sheets: [{ id: 1, projectId: 1, position: 0, widthMm: 420, heightMm: 594, paperKey: 'a2', name: '' }],
      objects: [{ id: 1, sheetId: 1, z: 0, kind: 'rect', assetId: null, pageIndex: 0, x: 0, y: 0, w: 420, h: 594, rotationDeg: 0, mirrorX: false, mirrorY: false, lockAspect: true, crop: null, fit: 'fill', repeat: null, props: {}, name: '', locked: false, hidden: false }],
      assets: [],
    };
    const s = planSummary(planProject(doc, settings, null, ctx));
    expect(s).toMatchObject({ tiles: 8, maps: 1, pages: 9, mode: 'tiled', orientation: 'landscape' });
    expect(rotatedBounds({ ...box(0, 0, 1, 1) })).toBeTruthy();
    expect(paperSize('a4')).toEqual({ w: 210, h: 297 });
  });
});
