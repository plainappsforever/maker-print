// Inspector for the selected object (SPEC §9.2): X, Y, W, H in any unit, Scale %, lock aspect, rotation, mirror,
// fit/fill, crop, Repeat (cols, rows, gaps, Fill sheet, trim marks), PPI line, known length, per-kind properties,
// the importer's report, Duplicate / Delete. Every change goes to the parent, which autosaves through the queue.
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { Asset } from '@/db/assets';
import type { Repeat } from '@/db/guards';
import type { SheetObject } from '@/db/objects';
import { isAssetObject, isVectorAsset, naturalOf, ppiOf, scaleOf } from '@/editor/info';
import { lockedResize, NO_CROP, normaliseDeg, sizeAtScale, type Rect } from '@/engine/geometry';
import { parseLength } from '@/engine/units';
import { repeatCopies, fillSheet } from '@/engine/repeat';
import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';
import type { AssetReport } from '@/import/assets';

import { AssetReportView } from './asset-report';
import { Chips, LengthField, NumberField, SmallButton, ToggleRow, type UnitPrefs } from './fields';

export type ObjectPatch = Partial<Omit<SheetObject, 'id' | 'sheetId' | 'kind' | 'assetId' | 'z'>>;
type Props = {
  o: SheetObject;
  asset: Asset | undefined;
  prefs: UnitPrefs;
  ppiTarget: number;
  /** safe area of the sheet (Fill sheet) */
  safe: Rect | null;
  /** the project's check bar is on: Fill sheet leaves the spare room at the bottom for it (D84) */
  checkBar?: boolean;
  onPatch: (patch: ObjectPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onKnownLength: () => void;
};

const NO_REPEAT: Repeat = { cols: 1, rows: 1, gap_x_mm: 0, gap_y_mm: 0, trim_marks: false };

export function Inspector({ o, asset, prefs, ppiTarget, safe, checkBar, onPatch, onDuplicate, onDelete, onKnownLength }: Props) {
  const theme = useTheme();
  const natural = naturalOf(o, asset);
  const vector = isVectorAsset(o);
  const scale = vector && natural ? scaleOf(o, natural) : null;
  const ppi = o.kind === 'image' && natural ? ppiOf(o, natural, ppiTarget) : null;
  const rep = o.repeat ?? NO_REPEAT;
  const copies = repeatCopies(o, o.repeat).length;
  const [fillMsg, setFillMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'size' | 'turn' | 'repeat' | 'more'>('size');
  const setRepeat = (r: Partial<Repeat>) => onPatch({ repeat: { ...rep, ...r } });
  const size = (side: 'w' | 'h', v: number) => onPatch(o.lockAspect ? lockedResize({ w: o.w, h: o.h }, side, v) : { [side]: v });
  const sub = (key: TranslationKey) => <Text style={[styles.sub, { color: theme.textSecondary }]}>{t(key)}</Text>;

  return (
    <View testID="inspector" style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text testID="inspector-title" numberOfLines={1} style={[styles.title, { color: theme.text }]}>
          {o.name || t(`kind.${o.kind}` as TranslationKey)}
        </Text>
        {scale && !scale.designed ? (
          <Text testID="badge-not-designed" style={[styles.badge, { backgroundColor: '#E65100' }]}>
            {t('inspector.notDesigned')}
          </Text>
        ) : null}
      </View>

      <Chips
        testID="insp-tab"
        value={tab}
        onChange={setTab}
        options={(['size', 'turn', 'repeat', 'more'] as const).map((k) => ({ value: k, label: t(`inspector.tab.${k}` as TranslationKey) }))}
      />
      {tab === 'size' ? (
        <>
      <View style={styles.row}>
        <LengthField label="X" testID="field-x" valueMm={o.x} prefs={prefs} kind="position" onCommit={(x) => onPatch({ x })} />
        <LengthField label="Y" testID="field-y" valueMm={o.y} prefs={prefs} kind="position" onCommit={(y) => onPatch({ y })} />
      </View>
      <View style={styles.row}>
        <LengthField label={t('inspector.w')} testID="field-w" valueMm={o.w} prefs={prefs} onCommit={(v) => size('w', v)} />
        <LengthField label={t('inspector.h')} testID="field-h" valueMm={o.h} prefs={prefs} onCommit={(v) => size('h', v)} />
      </View>
      <ToggleRow label={t('inspector.lockAspect')} testID="toggle-lock" value={o.lockAspect} onChange={(lockAspect) => onPatch({ lockAspect })} />
      {scale && natural ? (
        <View style={styles.row}>
          <NumberField
            label={t('inspector.scale')}
            testID="field-scale"
            value={Math.round(Math.min(scale.x, scale.y) * 100) / 100}
            min={0.1}
            max={10000}
            suffix="%"
            onCommit={(pct) => {
              const s = sizeAtScale(natural, o.crop ?? NO_CROP, pct);
              onPatch({ x: o.x + (o.w - s.w) / 2, y: o.y + (o.h - s.h) / 2, w: s.w, h: s.h });
            }}
          />
          <View style={styles.flex}>
            <Text testID="scale-line" style={[styles.line, { color: scale.designed ? theme.text : '#E65100' }]}>
              {scale.designed ? t('inspector.atDesigned') : t('inspector.scaleXY', { x: fmtPct(scale.x), y: fmtPct(scale.y) })}
            </Text>
          </View>
        </View>
      ) : null}
      {ppi ? (
        <Text testID="ppi-line" style={[styles.line, { color: ppi.band === 'sharp' || ppi.band === 'fine' ? theme.text : '#E65100' }]}>
          {t(`ppi.${ppi.band}` as TranslationKey, { ppi: Math.round(ppi.ppi) })}
        </Text>
      ) : null}
      {o.kind === 'image' && !natural ? <Text style={[styles.line, { color: theme.danger }]}>{t('inspector.sizeUnknown')}</Text> : null}

          {isAssetObject(o) && natural ? <SmallButton label={t('inspector.knownLength')} testID="known-length" onPress={onKnownLength} /> : null}
        </>
      ) : null}
      {tab === 'turn' ? (
        <>
      {sub('inspector.turn')}
      <View style={styles.row}>
        <NumberField label={t('inspector.rotation')} testID="field-rotation" value={o.rotationDeg} min={-3600} max={3600} suffix="°" onCommit={(v) => onPatch({ rotationDeg: normaliseDeg(v) })} />
        <View style={styles.buttons}>
          <SmallButton label="⟲ 90°" testID="rotate-left" onPress={() => onPatch({ rotationDeg: normaliseDeg(o.rotationDeg - 90) })} />
          <SmallButton label="⟳ 90°" testID="rotate-right" onPress={() => onPatch({ rotationDeg: normaliseDeg(o.rotationDeg + 90) })} />
        </View>
      </View>
      <View style={styles.row}>
        <ToggleRow label={t('inspector.mirrorH')} testID="toggle-mirror-h" value={o.mirrorX} onChange={(mirrorX) => onPatch({ mirrorX })} />
        <ToggleRow label={t('inspector.mirrorV')} testID="toggle-mirror-v" value={o.mirrorY} onChange={(mirrorY) => onPatch({ mirrorY })} />
      </View>

      {o.kind === 'image' || o.kind === 'pdf_page' ? (
        <>
          {sub('inspector.cropFit')}
          <Chips
            testID="fit"
            value={o.fit}
            onChange={(fit) => onPatch({ fit })}
            options={[
              { value: 'fill', label: t('inspector.fill') },
              { value: 'fit', label: t('inspector.fit') },
            ]}
          />
          <View style={styles.row}>
            {(['l', 't', 'r', 'b'] as const).map((k) => (
              <NumberField
                key={k}
                label={t(`inspector.crop.${k}` as TranslationKey)}
                testID={`field-crop-${k}`}
                value={Math.round((o.crop ?? NO_CROP)[k] * 1000) / 10}
                min={0}
                max={95}
                suffix="%"
                style={styles.quarter}
                onCommit={(v) => {
                  const crop = { ...(o.crop ?? NO_CROP), [k]: v / 100 };
                  if (crop.l + crop.r < 0.99 && crop.t + crop.b < 0.99) onPatch({ crop: crop.l || crop.t || crop.r || crop.b ? crop : null });
                }}
              />
            ))}
          </View>
        </>
      ) : null}

        </>
      ) : null}
      {tab === 'repeat' ? (
        <>
      {sub('inspector.repeat')}
      <View style={styles.row}>
        <NumberField label={t('inspector.cols')} testID="field-cols" value={rep.cols} integer min={1} max={1000} onCommit={(cols) => setRepeat({ cols })} />
        <NumberField label={t('inspector.rows')} testID="field-rows" value={rep.rows} integer min={1} max={1000} onCommit={(rows) => setRepeat({ rows })} />
      </View>
      <View style={styles.row}>
        <LengthField label={t('inspector.gapX')} testID="field-gap-x" kind="gap" valueMm={rep.gap_x_mm} prefs={prefs} onCommit={(gap_x_mm) => setRepeat({ gap_x_mm })} />
        <LengthField label={t('inspector.gapY')} testID="field-gap-y" kind="gap" valueMm={rep.gap_y_mm} prefs={prefs} onCommit={(gap_y_mm) => setRepeat({ gap_y_mm })} />
      </View>
      <ToggleRow label={t('inspector.trimMarks')} testID="toggle-trim" value={rep.trim_marks} onChange={(trim_marks) => setRepeat({ trim_marks })} />
      <View style={styles.row}>
        <SmallButton
          label={t('inspector.fillSheet')}
          testID="fill-sheet"
          onPress={() => {
            const f = safe ? fillSheet({ w: o.w, h: o.h, rotationDeg: o.rotationDeg }, { x: rep.gap_x_mm, y: rep.gap_y_mm }, safe, checkBar ? 'top' : 'centre') : null;
            if (!f) return setFillMsg(t('inspector.fillNone'));
            setFillMsg(null);
            onPatch({ x: f.x, y: f.y, repeat: { ...rep, cols: f.cols, rows: f.rows } });
          }}
        />
        <Text testID="copies-line" style={[styles.line, styles.flex, { color: theme.text }]}>
          {t('inspector.copies', { n: copies, cols: rep.cols, rows: rep.rows })}
        </Text>
      </View>
      {fillMsg ? <Text style={[styles.line, { color: theme.danger }]}>{fillMsg}</Text> : null}

        </>
      ) : null}
      {tab === 'more' ? (
        <>
      <KindProps o={o} prefs={prefs} onPatch={onPatch} />

      {isAssetObject(o) ? (
        <>
          {sub('inspector.report')}
          <AssetReportView report={(asset?.report as unknown as AssetReport) ?? null} testID="asset-report" />
        </>
      ) : null}

      <View style={[styles.row, styles.actions]}>
        <SmallButton label={t('inspector.duplicate')} testID="duplicate" onPress={onDuplicate} />
        <SmallButton label={t('inspector.delete')} testID="delete" danger onPress={onDelete} />
      </View>
        </>
      ) : null}
    </View>
  );
}

const fmtPct = (v: number) => String(Math.round(v * 100) / 100);

/** Per-kind properties: text, strokes, generator parameters (D45). */
function KindProps({ o, prefs, onPatch }: { o: SheetObject; prefs: UnitPrefs; onPatch: (p: ObjectPatch) => void }) {
  const theme = useTheme();
  const p = o.props;
  const set = (patch: Record<string, unknown>) => onPatch({ props: { ...p, ...patch } });
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const [diam, setDiam] = useState<string | null>(null);
  switch (o.kind) {
    case 'text':
      return (
        <View style={styles.group}>
          <TextInput
            testID="field-text"
            multiline
            value={String(p.text ?? '')}
            onChangeText={(text) => set({ text })}
            style={[styles.textInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <View style={styles.row}>
            <NumberField label={t('inspector.fontSize')} testID="field-font-size" value={num(p.fontSizePt, 12)} min={1} max={500} suffix="pt" onCommit={(fontSizePt) => set({ fontSizePt })} />
          </View>
          <Chips
            testID="align"
            value={(p.align as string) ?? 'left'}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: t('align.left') },
              { value: 'centre', label: t('align.centre') },
              { value: 'right', label: t('align.right') },
            ]}
          />
        </View>
      );
    case 'rect':
    case 'ellipse':
    case 'line':
      return (
        <View style={styles.group}>
          <View style={styles.row}>
            <LengthField label={t('inspector.stroke')} testID="field-stroke" kind="gap" valueMm={num(p.strokeMm, 0.3)} prefs={prefs} onCommit={(strokeMm) => set({ strokeMm })} />
          </View>
          {o.kind !== 'line' ? <ToggleRow label={t('inspector.filled')} testID="toggle-filled" value={typeof p.fill === 'string'} onChange={(v) => set({ fill: v ? '#000000' : null })} /> : null}
        </View>
      );
    case 'grid':
    case 'dots':
    case 'lines':
      return (
        <View style={styles.group}>
          <View style={styles.row}>
            <LengthField label={t('inspector.spacing')} testID="field-spacing" valueMm={num(p.spacingMm, o.kind === 'lines' ? 8 : 5)} prefs={prefs} onCommit={(spacingMm) => set({ spacingMm })} />
            {o.kind === 'grid' ? <NumberField label={t('inspector.boldEvery')} testID="field-bold-every" value={num(p.boldEvery, 2)} integer min={0} max={100} onCommit={(boldEvery) => set({ boldEvery })} /> : null}
          </View>
          {o.kind === 'grid' ? <ToggleRow label={t('inspector.numbered')} testID="toggle-numbered" value={p.numbered === true} onChange={(numbered) => set({ numbered })} /> : null}
          {o.kind === 'lines' ? <ToggleRow label={t('inspector.marginLine')} testID="toggle-margin-line" value={num(p.marginMm, 0) > 0} onChange={(v) => set({ marginMm: v ? Math.min(25, o.w / 4) : 0 })} /> : null}
        </View>
      );
    case 'ruler':
      return (
        <Chips
          testID="ruler-unit"
          value={(p.unit as string) ?? 'mm'}
          onChange={(unit) => set({ unit })}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'cm', label: 'cm' },
            { value: 'in', label: 'in' },
          ]}
        />
      );
    case 'circles': {
      const ds = Array.isArray(p.diametersMm) ? (p.diametersMm as number[]) : [5, 10, 20, 30, 40, 50];
      return (
        <View style={styles.group}>
          <Text style={[styles.sub, { color: theme.textSecondary }]}>{t('inspector.diameters')}</Text>
          <TextInput
            testID="field-diameters"
            value={diam ?? ds.map((d) => String(Math.round(d * 1000) / 1000)).join('; ')}
            onChangeText={(v) => {
              setDiam(v);
              const list = v.split(';').map((x) => parseLength(x, { unit: prefs.unit, locale: prefs.locale, positive: true }));
              if (list.length && list.every((r) => r.ok)) set({ diametersMm: list.map((r) => (r.ok ? r.mm : 0)) });
            }}
            onBlur={() => setDiam(null)}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        </View>
      );
    }
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  wrap: { gap: 10, paddingBottom: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  badge: { color: '#fff', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' },
  buttons: { flexDirection: 'row', gap: 6 },
  flex: { flex: 1 },
  quarter: { minWidth: 70 },
  line: { fontSize: 14 },
  sub: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 6 },
  group: { gap: 8 },
  actions: { marginTop: 8 },
  textInput: { minHeight: 60, borderRadius: 8, padding: 10, fontSize: 16 },
  input: { minHeight: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 16 },
});
