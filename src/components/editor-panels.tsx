// Editor bottom-bar panels (SPEC §9.2): Add · Align · Layers · Sheet.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ObjectKind, SheetObject } from '@/db/objects';
import type { Project } from '@/db/projects';
import type { Sheet } from '@/db/sheets';
import type { AlignMode } from '@/engine/align';
import { PAPERS, paperSize, type PaperKey } from '@/engine/paper';
import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';

import { Chips, LengthField, SmallButton, ToggleRow, type UnitPrefs } from './fields';

export const ADD_KINDS: readonly ObjectKind[] = ['text', 'rect', 'ellipse', 'line', 'ruler', 'grid', 'dots', 'lines', 'circles', 'test_square'];

function Tile({ label, testID, onPress, disabled }: { label: string; testID: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tile, { backgroundColor: theme.backgroundElement, opacity: pressed || disabled ? 0.5 : 1 }]}>
      <Text style={[styles.tileText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

export function AddPanel({ onAdd, onPhoto, onFile }: { onAdd: (kind: ObjectKind) => void; onPhoto: () => void; onFile: () => void }) {
  return (
    <View style={styles.grid}>
      <Tile label={t('add.photo')} testID="add-photo" onPress={onPhoto} />
      <Tile label={t('add.file')} testID="add-file" onPress={onFile} />
      {ADD_KINDS.map((k) => (
        <Tile key={k} label={t(`kind.${k}` as TranslationKey)} testID={`add-${k}`} onPress={() => onAdd(k)} />
      ))}
    </View>
  );
}

export function AlignPanel({ enabled, onAlign }: { enabled: boolean; onAlign: (mode: AlignMode, to: 'sheet' | 'safe') => void }) {
  const theme = useTheme();
  const [to, setTo] = useState<'sheet' | 'safe'>('safe');
  if (!enabled) return <Text style={[styles.hint, { color: theme.textSecondary }]}>{t('align.selectFirst')}</Text>;
  return (
    <View style={styles.col}>
      <Chips
        testID="align-to"
        value={to}
        onChange={setTo}
        options={[
          { value: 'safe', label: t('align.toSafe') },
          { value: 'sheet', label: t('align.toSheet') },
        ]}
      />
      <View style={styles.grid}>
        {(['left', 'centre', 'right', 'top', 'middle', 'bottom'] as const).map((m) => (
          <Tile key={m} label={t(`align.${m}` as TranslationKey)} testID={`align-${m}`} onPress={() => onAlign(m, to)} />
        ))}
      </View>
    </View>
  );
}

export function LayersPanel({
  objects,
  selectedId,
  onSelect,
  onMove,
  onToggle,
}: {
  objects: readonly SheetObject[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onMove: (id: number, dir: 1 | -1) => void;
  onToggle: (id: number, key: 'hidden' | 'locked') => void;
}) {
  const theme = useTheme();
  if (!objects.length) return <Text style={[styles.hint, { color: theme.textSecondary }]}>{t('layers.empty')}</Text>;
  const top = [...objects].reverse();
  return (
    <View style={styles.col}>
      {top.map((o, i) => (
        <View key={o.id} style={[styles.layer, { backgroundColor: o.id === selectedId ? theme.backgroundSelected : theme.backgroundElement }]}>
          <Pressable testID={`layer-${i}`} accessibilityRole="button" style={styles.layerName} onPress={() => onSelect(o.id)}>
            <Text numberOfLines={1} style={{ color: theme.text, opacity: o.hidden ? 0.5 : 1 }}>
              {o.name || t(`kind.${o.kind}` as TranslationKey)}
            </Text>
          </Pressable>
          <SmallButton label="↑" testID={`layer-up-${i}`} disabled={i === 0} onPress={() => onMove(o.id, 1)} />
          <SmallButton label="↓" testID={`layer-down-${i}`} disabled={i === top.length - 1} onPress={() => onMove(o.id, -1)} />
          <SmallButton label={o.hidden ? t('layers.show') : t('layers.hide')} testID={`layer-hide-${i}`} onPress={() => onToggle(o.id, 'hidden')} />
          <SmallButton label={o.locked ? t('layers.unlock') : t('layers.lock')} testID={`layer-lock-${i}`} onPress={() => onToggle(o.id, 'locked')} />
        </View>
      ))}
    </View>
  );
}

const SHEET_PAPERS: PaperKey[] = ['a4', 'letter', 'a3', 'a5', 'a6', 'legal', 'tabloid', 'a2', 'a1', 'a0', 'photo-4x6', 'photo-10x15'];
const OUTPUT_PAPERS: PaperKey[] = ['a4', 'letter', 'a3', 'a5', 'legal', 'tabloid', 'photo-4x6', 'photo-10x15', 'photo-13x18', 'photo-5x7'];
export const paperLabel = (k: PaperKey) => PAPERS.find((p) => p.key === k)?.label ?? k;

export function SheetPanel({
  sheets,
  current,
  project,
  prefs,
  snap,
  gridMm,
  onSheet,
  onPickSheet,
  onAddSheet,
  onDeleteSheet,
  onProject,
  onSnap,
  onGrid,
}: {
  sheets: readonly Sheet[];
  current: Sheet;
  project: Project;
  prefs: UnitPrefs;
  snap: boolean;
  gridMm: number | null;
  onSheet: (patch: { widthMm?: number; heightMm?: number; paperKey?: PaperKey | null }) => void;
  onPickSheet: (index: number) => void;
  onAddSheet: () => void;
  onDeleteSheet: () => void;
  onProject: (patch: { paperKey?: PaperKey }) => void;
  onSnap: (v: boolean) => void;
  onGrid: (mm: number | null) => void;
}) {
  const theme = useTheme();
  const sub = (k: TranslationKey) => <Text style={[styles.sub, { color: theme.textSecondary }]}>{t(k)}</Text>;
  const landscape = current.widthMm > current.heightMm;
  return (
    <View style={styles.col}>
      <View style={styles.row}>
        <SmallButton label={t('sheet.add')} testID="sheet-add" onPress={onAddSheet} />
        <SmallButton label={t('sheet.delete')} testID="sheet-delete" danger disabled={sheets.length < 2} onPress={onDeleteSheet} />
      </View>
      {sheets.length > 1 ? (
        <Chips testID="sheet-pick" value={sheets.findIndex((s) => s.id === current.id)} onChange={onPickSheet} options={sheets.map((s, i) => ({ value: i, label: t('sheet.n', { n: i + 1 }) }))} />
      ) : null}
      {sub('sheet.size')}
      <View style={styles.row}>
        <LengthField label={t('inspector.w')} testID="sheet-w" valueMm={current.widthMm} prefs={prefs} onCommit={(widthMm) => onSheet({ widthMm, paperKey: null })} />
        <LengthField label={t('inspector.h')} testID="sheet-h" valueMm={current.heightMm} prefs={prefs} onCommit={(heightMm) => onSheet({ heightMm, paperKey: null })} />
      </View>
      <Chips
        testID="sheet-paper"
        value={current.paperKey}
        onChange={(k) => {
          const s = paperSize(k, landscape ? 'landscape' : 'portrait');
          onSheet({ widthMm: s.w, heightMm: s.h, paperKey: k });
        }}
        options={SHEET_PAPERS.map((k) => ({ value: k, label: paperLabel(k) }))}
      />
      <SmallButton label={t('sheet.turn')} testID="sheet-turn" onPress={() => onSheet({ widthMm: current.heightMm, heightMm: current.widthMm })} />
      {sub('sheet.output')}
      <Chips testID="output-paper" value={project.paperKey} onChange={(paperKey) => onProject({ paperKey })} options={OUTPUT_PAPERS.map((k) => ({ value: k, label: paperLabel(k) }))} />
      {sub('sheet.snapping')}
      <ToggleRow label={t('sheet.snap')} testID="toggle-snap" value={snap} onChange={onSnap} />
      <Chips
        testID="grid"
        value={gridMm === null ? 'off' : gridMm === 1 ? 'mm1' : gridMm === 5 ? 'mm5' : 'in8'}
        onChange={(v) => onGrid(v === 'off' ? null : v === 'mm1' ? 1 : v === 'mm5' ? 5 : 25.4 / 8)}
        options={[
          { value: 'off', label: t('sheet.gridOff') },
          { value: 'mm1', label: '1 mm' },
          { value: 'mm5', label: '5 mm' },
          { value: 'in8', label: '⅛ in' },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  col: { gap: 10, paddingBottom: 24 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' },
  tile: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, minWidth: 96, alignItems: 'center' },
  tileText: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 14 },
  layer: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, padding: 4 },
  layerName: { flex: 1, paddingHorizontal: 8, paddingVertical: 8 },
  sub: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 6 },
});
