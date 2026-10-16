// "New" (SPEC §9.1): Blank (default paper, one tap) · Blank sheet of another paper · Big print (custom size, tiled) ·
// Open file · Template (Ruler, Graph paper, Dot grid, Lined paper, Circle template, Test square).
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { defaultTemplateParams, TEMPLATE_KINDS, type TemplateKind, type TemplateParams } from '@/editor/templates';
import { paperSize, type PaperKey } from '@/engine/paper';
import { parseLength } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { t, type TranslationKey } from '@/i18n';

import { Button } from './button';
import { paperLabel } from './editor-panels';
import { Chips, LengthField, NumberField, ToggleRow, type UnitPrefs } from './fields';

export type NewChoice =
  | { kind: 'blank'; paperKey: PaperKey; landscape: boolean }
  | { kind: 'big'; widthMm: number; heightMm: number }
  | { kind: 'file' }
  | { kind: 'template'; template: TemplateKind; params: TemplateParams };

const BLANK_PAPERS: PaperKey[] = ['a4', 'letter', 'a3', 'a5', 'a6', 'legal', 'tabloid', 'b5', 'photo-4x6', 'photo-5x7', 'photo-10x15', 'photo-13x18', 'photo-8x10'];
const TEMPLATE_PAPERS: PaperKey[] = ['a4', 'letter', 'a3', 'a5', 'legal'];
type Step = 'menu' | 'blank' | 'big' | 'templates' | TemplateKind;

export function NewProjectSheet({ visible, defaultPaper, prefs, onChoose, onClose }: { visible: boolean; defaultPaper: PaperKey; prefs: UnitPrefs; onChoose: (c: NewChoice) => void; onClose: () => void }) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>('menu');
  const [paper, setPaper] = useState<PaperKey>(defaultPaper);
  const [landscape, setLandscape] = useState(false);
  const [big, setBig] = useState({ w: 600, h: 900 });
  const [params, setParams] = useState<TemplateParams | null>(null);
  const [diam, setDiam] = useState<string | null>(null);
  const close = () => {
    setStep('menu');
    onClose();
  };
  const choose = (c: NewChoice) => {
    setStep('menu');
    onChoose(c);
  };
  const openTemplate = (k: TemplateKind) => {
    setParams(defaultTemplateParams(k, defaultPaper, prefs.unit));
    setDiam(null);
    setStep(k);
  };
  const item = (label: string, testID: string, onPress: () => void, detail?: string) => (
    <Pressable key={testID} testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.item, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 }]}>
      <Text style={[styles.itemText, { color: theme.text }]}>{label}</Text>
      {detail ? <Text style={[styles.detail, { color: theme.textSecondary }]}>{detail}</Text> : null}
    </Pressable>
  );
  const isTemplate = (TEMPLATE_KINDS as readonly string[]).includes(step);
  const p = params;
  const setP = (patch: Partial<TemplateParams>) => setParams((x) => (x ? { ...x, ...patch } : x));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ScrollView testID="new-sheet" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Text style={[styles.title, { color: theme.text }]}>{t(step === 'menu' ? 'new.title' : isTemplate ? (`template.${step}` as TranslationKey) : (`new.${step}` as TranslationKey))}</Text>
          <Pressable testID="new-close" accessibilityRole="button" onPress={step === 'menu' ? close : () => setStep(isTemplate ? 'templates' : 'menu')} hitSlop={10}>
            <Text style={[styles.link, { color: theme.tint }]}>{step === 'menu' ? t('common.cancel') : t('common.back')}</Text>
          </Pressable>
        </View>
        {step === 'menu' ? (
          <>
            {item(t('new.blankPaper', { paper: paperLabel(defaultPaper) }), 'new-blank-default', () => choose({ kind: 'blank', paperKey: defaultPaper, landscape: false }))}
            {item(t('new.blank'), 'new-blank', () => setStep('blank'), t('new.blankDetail'))}
            {item(t('new.big'), 'new-big', () => setStep('big'), t('new.bigDetail'))}
            {item(t('new.file'), 'new-file', () => choose({ kind: 'file' }), t('new.fileDetail'))}
            {item(t('new.templates'), 'new-template', () => setStep('templates'), t('new.templatesDetail'))}
          </>
        ) : null}
        {step === 'blank' ? (
          <>
            <Chips testID="blank-paper" value={paper} onChange={setPaper} options={BLANK_PAPERS.map((k) => ({ value: k, label: paperLabel(k) }))} />
            <ToggleRow label={t('new.landscape')} testID="blank-landscape" value={landscape} onChange={setLandscape} />
            <Button label={t('new.create')} testID="blank-create" onPress={() => choose({ kind: 'blank', paperKey: paper, landscape })} />
          </>
        ) : null}
        {step === 'big' ? (
          <>
            <Text style={[styles.detail, { color: theme.textSecondary }]}>{t('new.bigHow')}</Text>
            <View style={styles.row}>
              <LengthField label={t('inspector.w')} testID="big-w" valueMm={big.w} prefs={prefs} onCommit={(w) => setBig((b) => ({ ...b, w }))} />
              <LengthField label={t('inspector.h')} testID="big-h" valueMm={big.h} prefs={prefs} onCommit={(h) => setBig((b) => ({ ...b, h }))} />
            </View>
            <Chips
              testID="big-preset"
              value={null}
              onChange={(k: PaperKey) => setBig({ w: paperSize(k).w, h: paperSize(k).h })}
              options={(['a2', 'a1', 'a0'] as PaperKey[]).map((k) => ({ value: k, label: paperLabel(k) }))}
            />
            <Button label={t('new.create')} testID="big-create" disabled={big.w > 3000 || big.h > 3000} onPress={() => choose({ kind: 'big', widthMm: big.w, heightMm: big.h })} />
            {big.w > 3000 || big.h > 3000 ? <Text style={{ color: theme.danger }}>{t('sheet.tooLarge')}</Text> : null}
          </>
        ) : null}
        {step === 'templates' ? TEMPLATE_KINDS.map((k) => item(t(`template.${k}` as TranslationKey), `template-${k}`, () => openTemplate(k), t(`template.${k}.detail` as TranslationKey))) : null}
        {isTemplate && p ? (
          <>
            {step === 'ruler' || step === 'test_square' ? (
              <View style={styles.row}>
                <LengthField label={t(step === 'ruler' ? 'template.length' : 'inspector.w')} testID="template-length" valueMm={p.lengthMm} prefs={prefs} onCommit={(lengthMm) => setP({ lengthMm })} />
                <LengthField label={t(step === 'ruler' ? 'template.height' : 'inspector.h')} testID="template-height" valueMm={p.heightMm} prefs={prefs} onCommit={(heightMm) => setP({ heightMm })} />
              </View>
            ) : null}
            {step === 'ruler' ? <Chips testID="template-unit" value={p.rulerUnit} onChange={(rulerUnit) => setP({ rulerUnit })} options={(['mm', 'cm', 'in'] as const).map((u) => ({ value: u, label: u }))} /> : null}
            {step === 'grid' || step === 'dots' || step === 'lines' ? (
              <View style={styles.row}>
                <LengthField label={t('inspector.spacing')} testID="template-spacing" valueMm={p.spacingMm} prefs={prefs} onCommit={(spacingMm) => setP({ spacingMm })} />
                {step === 'grid' ? <NumberField label={t('inspector.boldEvery')} testID="template-bold" value={p.boldEvery} integer min={0} max={100} onCommit={(boldEvery) => setP({ boldEvery })} /> : null}
              </View>
            ) : null}
            {step === 'grid' ? <ToggleRow label={t('inspector.numbered')} testID="template-numbered" value={p.numbered} onChange={(numbered) => setP({ numbered })} /> : null}
            {step === 'lines' ? <ToggleRow label={t('inspector.marginLine')} testID="template-margin" value={p.marginLine} onChange={(marginLine) => setP({ marginLine })} /> : null}
            {step === 'circles' ? (
              <View style={styles.field}>
                <Text style={[styles.detail, { color: theme.textSecondary }]}>{t('inspector.diameters')}</Text>
                <TextInput
                  testID="template-diameters"
                  value={diam ?? p.diametersMm.map((d) => String(Math.round(d * 1000) / 1000)).join('; ')}
                  onChangeText={(v) => {
                    setDiam(v);
                    const list = v.split(';').map((x) => parseLength(x, { unit: prefs.unit, locale: prefs.locale, positive: true }));
                    if (list.length && list.every((r) => r.ok)) setP({ diametersMm: list.map((r) => (r.ok ? r.mm : 0)) });
                  }}
                  onBlur={() => setDiam(null)}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
              </View>
            ) : null}
            <Text style={[styles.detail, { color: theme.textSecondary }]}>{t('template.paper')}</Text>
            <Chips testID="template-paper" value={p.paperKey} onChange={(paperKey) => setP({ paperKey })} options={TEMPLATE_PAPERS.map((k) => ({ value: k, label: paperLabel(k) }))} />
            <Button label={t('new.create')} testID="template-create" onPress={() => choose({ kind: 'template', template: step as TemplateKind, params: p })} />
          </>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 48 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '700', flexShrink: 1 },
  link: { fontSize: 16, fontWeight: '600' },
  item: { padding: 14, borderRadius: 12, gap: 2 },
  itemText: { fontSize: 17, fontWeight: '600' },
  detail: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  field: { gap: 4 },
  input: { minHeight: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 16 },
});
