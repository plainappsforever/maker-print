// Known-length scaling (SPEC §8.8, U6): drag two handles onto marks of known distance (a ruler in the photo), type the
// real length, and the object is scaled about its centre with the aspect locked. Points live in the source's natural
// coordinates (image px / PDF or SVG mm), exactly what `scaleFromKnownLength` takes.
import { useReducer, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Circle, Image as SvgImage, Line } from 'react-native-svg';

import type { SheetObject } from '@/db/objects';
import type { Point } from '@/engine/geometry';
import { measuredMm, scaleFromKnownLength } from '@/engine/known-length';
import { formatLength } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';

import { Button } from './button';
import { LengthField, type UnitPrefs } from './fields';

type Props = {
  o: SheetObject;
  natural: { w: number; h: number };
  href: string | null;
  prefs: UnitPrefs;
  onApply: (box: { x: number; y: number; w: number; h: number }) => void;
  onCancel: () => void;
};

type DragState = { pts: [Point, Point]; drag: { i: 0 | 1; start: Point } | null };
type DragAction = { t: 'begin'; i: 0 | 1 } | { t: 'move'; dx: number; dy: number; max: { w: number; h: number } } | { t: 'end' };
function reduce(s: DragState, a: DragAction): DragState {
  if (a.t === 'begin') return { ...s, drag: { i: a.i, start: s.pts[a.i] } };
  if (a.t === 'end') return { ...s, drag: null };
  if (!s.drag) return s;
  const q = { x: Math.min(a.max.w, Math.max(0, s.drag.start.x + a.dx)), y: Math.min(a.max.h, Math.max(0, s.drag.start.y + a.dy)) };
  return { ...s, pts: s.drag.i === 0 ? [q, s.pts[1]] : [s.pts[0], q] };
}

export function KnownLengthModal({ o, natural, href, prefs, onApply, onCancel }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [st, dispatch] = useReducer(reduce, {
    pts: [
      { x: natural.w * 0.25, y: natural.h * 0.5 },
      { x: natural.w * 0.75, y: natural.h * 0.5 },
    ],
    drag: null,
  });
  const pts = st.pts;
  const [lengthMm, setLengthMm] = useState(100);
  const k = width > 0 ? width / natural.w : 1; // screen points per natural unit
  const height = natural.h * k;

  const gesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(1)
    .onStart((e) => {
      const x = (e.x - e.translationX) / k;
      const y = (e.y - e.translationY) / k;
      const d0 = Math.hypot(pts[0].x - x, pts[0].y - y);
      const d1 = Math.hypot(pts[1].x - x, pts[1].y - y);
      if (Math.min(d0, d1) * k <= 60) dispatch({ t: 'begin', i: d0 <= d1 ? 0 : 1 });
    })
    .onUpdate((e) => dispatch({ t: 'move', dx: e.translationX / k, dy: e.translationY / k, max: natural }))
    .onFinalize(() => dispatch({ t: 'end' }));

  const input = { box: o, natural, crop: o.crop, fit: o.fit, p1: pts[0], p2: pts[1] };
  const now = measuredMm(input);
  const fmt = (mm: number) => formatLength(mm, { unit: prefs.unit, inchStyle: prefs.inchStyle, locale: prefs.locale });
  const result = scaleFromKnownLength({ ...input, lengthMm });
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <GestureHandlerRootView style={styles.flex}>
        <ScrollView testID="known-length" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} scrollEnabled={false}>
          <Text style={[styles.title, { color: theme.text }]}>{t('known.title')}</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{t('known.how')}</Text>
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.stage, { height: height || 200 }]}>
            {width > 0 ? (
              <GestureDetector gesture={gesture}>
                <View testID="known-stage" collapsable={false}>
                  <Svg width={width} height={height}>
                    {href ? <SvgImage href={{ uri: href }} x={0} y={0} width={width} height={height} preserveAspectRatio="none" /> : null}
                    <Line x1={pts[0].x * k} y1={pts[0].y * k} x2={pts[1].x * k} y2={pts[1].y * k} stroke="#E91E63" strokeWidth={2} />
                    {pts.map((p, i) => (
                      <Circle key={i} cx={p.x * k} cy={p.y * k} r={12} fill="rgba(233,30,99,0.25)" stroke="#E91E63" strokeWidth={2} />
                    ))}
                    {pts.map((p, i) => (
                      <Circle key={`c${i}`} cx={p.x * k} cy={p.y * k} r={1.5} fill="#E91E63" />
                    ))}
                  </Svg>
                </View>
              </GestureDetector>
            ) : null}
          </View>
          <Text testID="known-now" style={[styles.body, { color: theme.text }]}>
            {t('known.now', { length: fmt(now) })}
          </Text>
          <LengthField label={t('known.real')} testID="known-real" valueMm={lengthMm} prefs={prefs} onCommit={setLengthMm} />
          {result ? (
            <Text testID="known-result" style={[styles.body, { color: theme.text }]}>
              {t('known.result', { factor: String(Math.round(result.factor * 10000) / 10000), w: fmt(result.w), h: fmt(result.h) })}
            </Text>
          ) : null}
          <Button label={t('known.apply')} testID="known-apply" disabled={!result} onPress={() => result && onApply(result)} />
          <Button label={t('common.cancel')} testID="known-cancel" variant="secondary" onPress={onCancel} />
        </ScrollView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20, gap: 12, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  stage: { width: '100%', backgroundColor: '#ddd' },
});
