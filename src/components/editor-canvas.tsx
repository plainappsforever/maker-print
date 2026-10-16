// Editor canvas (SPEC §9.2, D20, D21): tap = select; drag = move (snapping, guide line); corner handle = resize
// (aspect locked unless unlocked); top handle = rotate; two fingers = zoom/pan; one finger on empty paper = pan.
// Gestures run on the JS thread (react-native-gesture-handler, runOnJS) and feed a reducer: the live box is local
// state, the parent receives one commit per gesture (autosave), so a drag re-renders only the canvas.
import { useReducer, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { G } from 'react-native-svg';

import type { Asset } from '@/db/assets';
import type { SheetObject } from '@/db/objects';
import { HANDLE_HIT_PT, hitHandle, hitObject, moveBox, resizeBox, rotateBox, ROTATE_HANDLE_PT, snapContextFor, type Box, type Corner, type SnapContext } from '@/editor/gestures';
import { fitView, panBy, toMm, zoomAbout, type View as ViewT } from '@/editor/view';
import type { Point } from '@/engine/geometry';
import type { GenContext } from '@/engine/generators';
import type { Margins } from '@/engine/paper';
import type { SnapGuide } from '@/engine/snap';
import type { Tile } from '@/engine/tiles';
import { t } from '@/i18n';

import { SheetGraphic } from './sheet-graphic';

export type ObjectChange = Partial<Pick<SheetObject, 'x' | 'y' | 'w' | 'h' | 'rotationDeg'>>;
type Mode =
  | { kind: 'move'; id: number; start: Box }
  | { kind: 'resize'; id: number; start: Box; corner: Corner; lock: boolean }
  | { kind: 'rotate'; id: number; start: Box; from: Point }
  | { kind: 'pan'; view: ViewT };
type Live = { id: number; change: ObjectChange; guides: SnapGuide[] };
type ViewGesture = { start: ViewT; scale: number; focal: Point; tx: number; ty: number };
type State = { mode: Mode | null; live: Live | null; vg: ViewGesture | null };
type Action =
  | { t: 'begin'; mode: Mode | null }
  | { t: 'live'; live: Live | null }
  | { t: 'end' }
  | { t: 'vgStart'; view: ViewT }
  | { t: 'vgPinch'; scale: number; focal: Point }
  | { t: 'vgPan'; tx: number; ty: number }
  | { t: 'vgEnd' };

function reduce(s: State, a: Action): State {
  switch (a.t) {
    case 'begin':
      return { ...s, mode: a.mode, live: null };
    case 'live':
      return s.mode ? { ...s, live: a.live } : s;
    case 'end':
      return { ...s, mode: null, live: null };
    case 'vgStart':
      return s.vg ? s : { ...s, vg: { start: a.view, scale: 1, focal: { x: 0, y: 0 }, tx: 0, ty: 0 } };
    case 'vgPinch':
      return s.vg ? { ...s, vg: { ...s.vg, scale: a.scale, focal: a.focal } } : s;
    case 'vgPan':
      return s.vg ? { ...s, vg: { ...s.vg, tx: a.tx, ty: a.ty } } : s;
    case 'vgEnd':
      return { ...s, vg: null };
  }
}

const viewOf = (g: ViewGesture) => panBy(zoomAbout(g.start, g.scale, g.focal), g.tx, g.ty);

/** The box change of the running gesture at pointer (x, y) / translation (tx, ty), in screen points. */
function changeAt(m: Mode, v: ViewT, x: number, y: number, tx: number, ty: number, snap: SnapContext | null): Live | null {
  if (m.kind === 'pan') return null;
  if (m.kind === 'move') {
    const r = moveBox(m.start, tx / v.scale, ty / v.scale, snap);
    return { id: m.id, change: { x: r.x, y: r.y }, guides: r.guides };
  }
  if (m.kind === 'resize') {
    const r = resizeBox(m.start, m.corner, toMm(v, { x, y }), m.lock, snap);
    return { id: m.id, change: { x: r.x, y: r.y, w: r.w, h: r.h }, guides: r.guides };
  }
  return { id: m.id, change: { rotationDeg: rotateBox(m.start, m.from, toMm(v, { x, y })) }, guides: [] };
}

export type EditorCanvasProps = {
  sheet: { id: number; widthMm: number; heightMm: number };
  objects: readonly SheetObject[];
  assets: ReadonlyMap<number, Asset>;
  previews: Readonly<Record<string, string>>;
  ctx: GenContext;
  margins: Margins | null;
  hatch: Margins | null;
  tiles: readonly Tile[];
  gridMm: number | null;
  snap: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onCommit: (id: number, change: ObjectChange) => void;
};

export function EditorCanvas(props: EditorCanvasProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // the view resets to "whole sheet" whenever the sheet, its size or the canvas size changes
  const fitKey = `${props.sheet.id}:${props.sheet.widthMm}x${props.sheet.heightMm}:${size?.w}x${size?.h}`;
  const [stored, setStored] = useState<{ key: string; view: ViewT } | null>(null);
  const [s, dispatch] = useReducer(reduce, { mode: null, live: null, vg: null });
  const base = stored?.key === fitKey ? stored.view : size ? fitView({ w: props.sheet.widthMm, h: props.sheet.heightMm }, size) : null;
  const view = s.vg ? viewOf(s.vg) : base;
  const setView = (v: ViewT) => setStored({ key: fitKey, view: v });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || Math.abs(size.w - width) > 1 || Math.abs(size.h - height) > 1) setSize({ w: width, h: height });
  };

  const snapFor = (m: Mode, v: ViewT): SnapContext | null => {
    if (!props.snap || m.kind === 'pan') return null;
    const others = props.objects.filter((o) => o.id !== m.id && !o.hidden);
    return snapContextFor({ w: props.sheet.widthMm, h: props.sheet.heightMm }, props.margins ?? undefined, others, v.scale, props.gridMm ?? undefined);
  };

  const begin = (x: number, y: number) => {
    if (!view) return;
    const pt = toMm(view, { x, y });
    const sel = props.selectedId != null ? props.objects.find((o) => o.id === props.selectedId) : undefined;
    if (sel && !sel.locked && !sel.hidden) {
      const h = hitHandle(sel, pt, HANDLE_HIT_PT / view.scale, ROTATE_HANDLE_PT / view.scale);
      if (h?.kind === 'corner') return dispatch({ t: 'begin', mode: { kind: 'resize', id: sel.id, start: sel, corner: h.corner, lock: sel.lockAspect } });
      if (h?.kind === 'rotate') return dispatch({ t: 'begin', mode: { kind: 'rotate', id: sel.id, start: sel, from: pt } });
    }
    const hit = hitObject(props.objects, pt, 2 / view.scale);
    if (hit) {
      if (hit.id !== props.selectedId) props.onSelect(hit.id);
      return dispatch({ t: 'begin', mode: { kind: 'move', id: hit.id, start: hit } });
    }
    dispatch({ t: 'begin', mode: { kind: 'pan', view } });
  };
  const update = (x: number, y: number, tx: number, ty: number) => {
    const m = s.mode;
    if (!m || !view) return;
    if (m.kind === 'pan') return setView(panBy(m.view, tx, ty));
    dispatch({ t: 'live', live: changeAt(m, view, x, y, tx, ty, snapFor(m, view)) });
  };
  const end = (x: number, y: number, tx: number, ty: number) => {
    const m = s.mode;
    if (m && m.kind !== 'pan' && view) {
      const l = changeAt(m, view, x, y, tx, ty, snapFor(m, view));
      if (l) props.onCommit(l.id, l.change);
    }
    dispatch({ t: 'end' });
  };

  const one = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .minDistance(3)
    .onStart((e) => begin(e.x - e.translationX, e.y - e.translationY))
    .onUpdate((e) => update(e.x, e.y, e.translationX, e.translationY))
    .onEnd((e) => end(e.x, e.y, e.translationX, e.translationY))
    .onFinalize(() => dispatch({ t: 'end' }));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(400)
    .onEnd((e) => {
      if (!view) return;
      const hit = hitObject(props.objects, toMm(view, { x: e.x, y: e.y }), 2 / view.scale);
      props.onSelect(hit ? hit.id : null);
    });
  const zoom = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => view && dispatch({ t: 'vgStart', view }))
    .onUpdate((e) => dispatch({ t: 'vgPinch', scale: e.scale, focal: { x: e.focalX, y: e.focalY } }))
    .onEnd(() => s.vg && setView(viewOf(s.vg)))
    .onFinalize(() => dispatch({ t: 'vgEnd' }));
  const two = Gesture.Pan()
    .runOnJS(true)
    .minPointers(2)
    .onStart(() => view && dispatch({ t: 'vgStart', view }))
    .onUpdate((e) => dispatch({ t: 'vgPan', tx: e.translationX, ty: e.translationY }))
    .onEnd(() => s.vg && setView(viewOf(s.vg)))
    .onFinalize(() => dispatch({ t: 'vgEnd' }));
  const gesture = Gesture.Simultaneous(Gesture.Simultaneous(zoom, two), Gesture.Exclusive(one, tap));

  const live = s.live;
  const shown = live ? props.objects.map((o) => (o.id === live.id ? { ...o, ...live.change } : o)) : props.objects;

  return (
    <View style={styles.wrap} onLayout={onLayout} testID="editor-canvas">
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          {size && view ? (
            <Svg width={size.w} height={size.h}>
              <G transform={[view.scale, 0, 0, view.scale, view.tx, view.ty]}>
                <SheetGraphic
                  sheet={props.sheet}
                  objects={shown}
                  assets={props.assets}
                  previews={props.previews}
                  ctx={props.ctx}
                  scale={view.scale}
                  margins={props.margins}
                  hatch={props.hatch}
                  tiles={props.tiles}
                  gridMm={props.gridMm}
                  guides={live?.guides}
                  selectedId={props.selectedId}
                />
              </G>
            </Svg>
          ) : null}
        </View>
      </GestureDetector>
      <Pressable testID="canvas-fit" accessibilityRole="button" style={styles.fit} onPress={() => size && setView(fitView({ w: props.sheet.widthMm, h: props.sheet.heightMm }, size))}>
        <Text style={styles.fitText}>{t('editor.fit')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#D9DCE1', overflow: 'hidden' },
  fit: { position: 'absolute', right: 8, top: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.9)' },
  fitText: { fontSize: 13, fontWeight: '600', color: '#0A6BD8' },
});
