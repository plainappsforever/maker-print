// Editor (SPEC §9.2): the sheet at true proportions with safe area, learned non-printable area and tile boundaries;
// select / drag / resize / rotate with snapping; Add · Align · Layers · Sheet; inspector; imports with their questions.
// Every edit autosaves through the write queue (debounced 250 ms during drags, flushed on release, Back and background).
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/db/provider';
import { useCallback, useEffect, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditorCanvas, type ObjectChange } from '@/components/editor-canvas';
import { AddPanel, AlignPanel, LayersPanel, SheetPanel, paperLabel } from '@/components/editor-panels';
import { BusyOverlay, nextFrame, type UnitPrefs } from '@/components/fields';
import { PdfPagesModal, SvgUnitsModal } from '@/components/import-modals';
import { Inspector, type ObjectPatch } from '@/components/inspector';
import { KnownLengthModal } from '@/components/known-length-modal';
import { previewKey } from '@/components/sheet-graphic';
import { setSvgPxPerIn, type Asset } from '@/db/assets';
import { addObject, deleteObject, duplicateObject, setObjectOrder, updateObject, type ObjectKind } from '@/db/objects';
import type { Profile } from '@/db/profiles';
import { deleteProject, updateProject } from '@/db/projects';
import type { AppSettings } from '@/db/settings';
import { addSheet, deleteSheet, updateSheet } from '@/db/sheets';
import { Autosave } from '@/editor/autosave';
import { SLOW_IMPORT_BYTES } from '@/editor/filekind';
import { isAssetObject, naturalOf } from '@/editor/info';
import { effectiveMargins, sheetTiles, type ProjectDoc } from '@/editor/output';
import { centreOn } from '@/editor/place';
import { newObjectDefaults } from '@/editor/templates';
import { alignTo, type AlignMode } from '@/engine/align';
import type { GenContext } from '@/engine/generators';
import { safeArea, type Margins, type PaperKey } from '@/engine/paper';
import { formatLength } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { getUiLanguage, printTranslator, t, type TranslationKey } from '@/i18n';
import { loadOutputContext, loadProjectDoc, previewUris } from '@/lib/doc';
import { removeProjectFolder } from '@/lib/files';
import { discardAsset, pickFile, pickPhoto, placeAsset, prepareImport, storeAsset, type PickedFile, type PlaceTarget } from '@/lib/import';

type Panel = 'inspector' | 'add' | 'align' | 'layers' | 'sheet' | null;
type PlaceEnv = { paperKey: PaperKey; margins: Margins; ppiTarget: number };
type Question = { asset: Asset; target: PlaceTarget; isNew: boolean; kind: 'svg' | 'pdf'; env: PlaceEnv };
const envOf = (d: ProjectDoc, o: { settings: AppSettings; profile: Profile | null }): PlaceEnv => ({
  paperKey: d.project.paperKey,
  margins: effectiveMargins(d.project, o.profile, o.settings),
  ppiTarget: o.settings.ppiTarget,
});
const VECTOR_LOCKED: readonly ObjectKind[] = ['test_square'];

export default function EditorScreen() {
  const params = useLocalSearchParams<{ id: string; pending?: string }>();
  const projectId = Number(params.id);
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const lang = getUiLanguage();
  const [doc, setDoc] = useState<ProjectDoc | null>(null);
  const [out, setOut] = useState<{ settings: AppSettings; profile: Profile | null } | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [snap, setSnap] = useState(true);
  const [gridMm, setGridMm] = useState<number | null>(null);
  const [busy, setBusy] = useState<{ text: string; detail: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [known, setKnown] = useState(false);
  const [autosave] = useState(() => new Autosave((id, p) => updateObject(db, id, p as ObjectPatch), 250, () => setError(t('editor.saveFailed'))));

  const reload = async () => {
    const d = await loadProjectDoc(db, projectId);
    setDoc(d);
    if (d) setPreviews(await previewUris(d));
    return d;
  };

  // first load; a file opened from the Projects screen arrives with its asset stored, waiting for its questions
  useEffect(() => {
    let alive = true;
    loadProjectDoc(db, projectId).then(async (d) => {
      const o = await loadOutputContext(db, d?.project.profileId ?? null);
      const p = d ? await previewUris(d) : {};
      if (!alive) return;
      setDoc(d);
      setOut(o);
      setPreviews(p);
      const asset = d && params.pending ? d.assets.find((a) => a.id === Number(params.pending)) : undefined;
      if (d && asset) {
        router.setParams({ pending: undefined });
        ask(asset, { mode: 'new', sheetId: d.sheets[0].id }, true, envOf(d, o));
      }
    });
    return () => {
      alive = false;
    };
    // load once per project; `pending` is consumed by this load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, projectId]);

  // Back, another screen, or the app going to the background: write what is pending now (L10)
  useFocusEffect(
    useCallback(() => {
      const sub = AppState.addEventListener('change', (st) => {
        if (st !== 'active') void autosave.flush();
      });
      return () => {
        sub.remove();
        void autosave.flush();
      };
    }, [autosave])
  );

  const sheets = doc?.sheets ?? [];
  const sheet = sheets[Math.min(sheetIndex, Math.max(0, sheets.length - 1))];
  const objects = doc && sheet ? doc.objects.filter((o) => o.sheetId === sheet.id) : [];
  const assets = new Map((doc?.assets ?? []).map((a) => [a.id, a]));
  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const prefs: UnitPrefs = { unit: out?.settings.units ?? 'mm', inchStyle: out?.settings.inchStyle ?? 'fraction16', locale: lang };
  const ctx: GenContext = { locale: lang, unit: out?.settings.units ?? 'mm', inchStyle: out?.settings.inchStyle ?? 'fraction16', t: printTranslator(lang) };
  const margins = doc && out ? effectiveMargins(doc.project, out.profile, out.settings) : null;
  const layout = doc && sheet && margins ? sheetTiles(sheet, doc.project, margins) : null;
  const safe = sheet && margins ? safeArea({ w: sheet.widthMm, h: sheet.heightMm }, margins) : null;
  const hatch = layout?.layout.mode === 'single' && out?.profile?.margins ? out.profile.margins : null;

  const select = (id: number | null) => {
    setSelectedId(id);
    setPanel((p) => (id !== null ? 'inspector' : p === 'inspector' ? null : p));
  };

  const patch = (id: number, change: ObjectPatch | ObjectChange) => {
    setDoc((d) => (d ? { ...d, objects: d.objects.map((o) => (o.id === id ? { ...o, ...change } : o)) } : d));
    autosave.schedule(id, change);
  };

  // ---------------------------------------------------------------------------------------------- import
  const place = async (asset: Asset, pages: number[], target: PlaceTarget, env: PlaceEnv) => {
    setBusy({ text: t('import.placing'), detail: null });
    try {
      const r = await placeAsset(db, asset, pages, target, env);
      const d = await reload();
      if (r && d) {
        setSheetIndex(Math.max(0, d.sheets.findIndex((x) => x.id === r.sheetId)));
        select(r.objectId);
      }
    } finally {
      setBusy(null);
    }
  };

  function ask(asset: Asset, target: PlaceTarget, isNew: boolean, env: PlaceEnv) {
    const rep = asset.report as { kind?: string; needsPpi?: boolean } | null;
    if (asset.kind === 'svg' && rep?.needsPpi && !asset.svgPxPerIn) return setQuestion({ asset, target, isNew, kind: 'svg', env });
    if (asset.kind === 'pdf' && (asset.pageCount ?? 1) > 1) return setQuestion({ asset, target, isNew, kind: 'pdf', env });
    void place(asset, [0], target, env);
  }

  const importPicked = async (picked: PickedFile | null) => {
    if (!picked || !doc || !sheet) return;
    setError(null);
    setBusy({ text: t('import.reading'), detail: (picked.size ?? 0) > SLOW_IMPORT_BYTES ? t('import.slow') : null });
    await nextFrame();
    const r = await prepareImport(picked, [lang]);
    if (!r.ok) {
      setBusy(null);
      return setError(t(`import.error.${r.error}` as TranslationKey));
    }
    const asset = await storeAsset(db, projectId, r.file, [lang]);
    setBusy(null);
    if (doc && out) ask(asset, { mode: 'add', sheetId: sheet.id, sheet }, false, envOf(doc, out));
  };

  const cancelQuestion = async () => {
    const q = question;
    setQuestion(null);
    if (!q) return;
    if (q.isNew) {
      await deleteProject(db, projectId);
      removeProjectFolder(projectId);
      router.back();
    } else {
      await discardAsset(db, q.asset);
      await reload();
    }
  };

  // ---------------------------------------------------------------------------------------------- object actions
  const addVector = async (kind: ObjectKind) => {
    if (!sheet || !safe) return;
    const d = newObjectDefaults(kind, sheet, safe, t('kind.textDefault'));
    const box = d.fill ? { x: safe.x, y: safe.y, w: d.w, h: d.h } : centreOn(sheet, d);
    const id = await addObject(db, sheet.id, { kind, ...box, props: d.props, lockAspect: VECTOR_LOCKED.includes(kind) });
    await reload();
    select(id);
  };

  const align = (mode: AlignMode, to: 'sheet' | 'safe') => {
    if (!selected || !sheet) return;
    const target = to === 'sheet' || !safe ? { x: 0, y: 0, w: sheet.widthMm, h: sheet.heightMm } : safe;
    patch(selected.id, alignTo(selected, mode, target));
  };

  const moveLayer = async (id: number, dir: 1 | -1) => {
    if (!sheet) return;
    const ids = objects.map((o) => o.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await autosave.flush();
    await setObjectOrder(db, sheet.id, ids);
    await reload();
  };

  const duplicate = async () => {
    if (!selected) return;
    await autosave.flush();
    const id = await duplicateObject(db, selected.id);
    await reload();
    select(id);
  };

  const remove = async () => {
    if (!selected) return;
    autosave.forget(selected.id);
    await autosave.flush();
    await deleteObject(db, selected.id);
    select(null);
    await reload();
  };

  const sheetPatch = async (p: { widthMm?: number; heightMm?: number; paperKey?: PaperKey | null }) => {
    if (!sheet) return;
    try {
      await updateSheet(db, sheet.id, p);
      setError(null);
    } catch {
      setError(t('sheet.tooLarge'));
    }
    await reload();
  };

  if (!doc || !out || !sheet) {
    return <View testID="editor-loading" style={[styles.flex, { backgroundColor: theme.background }]} />;
  }

  const sizeText = `${formatLength(sheet.widthMm, { ...prefs, withUnit: false })} × ${formatLength(sheet.heightMm, prefs)}`;
  const pagesText = layout ? (layout.layout.mode === 'tiled' ? t('editor.tiles', { n: layout.layout.pages, paper: paperLabel(doc.project.paperKey), orientation: t(`orientation.${layout.layout.orientation}` as TranslationKey) }) : t(`editor.mode.${layout.layout.mode}` as TranslationKey, { paper: paperLabel(doc.project.paperKey) })) : '';
  const assetOfSelected = selected?.assetId != null ? assets.get(selected.assetId) : undefined;
  const naturalSelected = selected ? naturalOf(selected, assetOfSelected) : null;

  return (
    <View testID="editor-screen" style={[styles.flex, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: doc.project.name,
          headerRight: () => (
            <Pressable
              testID="editor-print"
              accessibilityRole="button"
              hitSlop={8}
              onPress={async () => {
                await autosave.flush();
                router.push({ pathname: '/project/[id]/print', params: { id: String(projectId) } });
              }}>
              <Text style={[styles.headerButton, { color: theme.tint }]}>{t('editor.print')}</Text>
            </Pressable>
          ),
        }}
      />
      <Pressable testID="sheet-chip" accessibilityRole="button" onPress={() => setPanel(panel === 'sheet' ? null : 'sheet')} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
        <Text style={[styles.chipText, { color: theme.text }]} numberOfLines={2}>
          {sheets.length > 1 ? `${t('sheet.nOf', { n: sheetIndex + 1, total: sheets.length })} · ` : ''}
          {sizeText} · <Text testID="sheet-pages">{pagesText}</Text>
        </Text>
      </Pressable>
      {error ? (
        <Pressable testID="editor-error" onPress={() => setError(null)} style={[styles.error, { backgroundColor: theme.danger }]}>
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      ) : null}
      <EditorCanvas
        sheet={sheet}
        objects={objects}
        assets={assets}
        previews={previews}
        ctx={ctx}
        margins={margins}
        hatch={hatch}
        tiles={layout?.tiles ?? []}
        gridMm={gridMm}
        snap={snap}
        selectedId={selectedId}
        onSelect={select}
        onCommit={(id, change) => {
          patch(id, change);
          void autosave.flush();
        }}
      />
      {panel ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100} style={styles.panelWrap}>
          <ScrollView testID={`panel-${panel}`} style={[styles.panel, { backgroundColor: theme.background }]} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
            {panel === 'inspector' && selected ? (
              <Inspector
                key={selected.id}
                o={selected}
                asset={assetOfSelected}
                prefs={prefs}
                ppiTarget={out.settings.ppiTarget}
                safe={safe}
                checkBar={doc?.project.checkBar ?? out?.settings.checkBar ?? true}
                onPatch={(p) => patch(selected.id, p)}
                onDuplicate={duplicate}
                onDelete={remove}
                onKnownLength={() => setKnown(true)}
              />
            ) : null}
            {panel === 'add' ? (
              <AddPanel
                onAdd={(k) => void addVector(k)}
                onPhoto={async () => importPicked(await pickPhoto())}
                onFile={async () => importPicked(await pickFile())}
              />
            ) : null}
            {panel === 'align' ? <AlignPanel enabled={!!selected} onAlign={align} /> : null}
            {panel === 'layers' ? (
              <LayersPanel objects={objects} selectedId={selectedId} onSelect={(id) => setSelectedId(id)} onMove={moveLayer} onToggle={(id, key) => patch(id, { [key]: !objects.find((o) => o.id === id)?.[key] })} />
            ) : null}
            {panel === 'sheet' ? (
              <SheetPanel
                sheets={sheets}
                current={sheet}
                project={doc.project}
                prefs={prefs}
                snap={snap}
                gridMm={gridMm}
                onSheet={sheetPatch}
                onPickSheet={(i) => {
                  setSheetIndex(i);
                  setSelectedId(null);
                }}
                onAddSheet={async () => {
                  await addSheet(db, projectId, { widthMm: sheet.widthMm, heightMm: sheet.heightMm, paperKey: sheet.paperKey });
                  const d = await reload();
                  if (d) setSheetIndex(d.sheets.length - 1);
                }}
                onDeleteSheet={async () => {
                  await autosave.flush();
                  await deleteSheet(db, sheet.id);
                  setSheetIndex(0);
                  setSelectedId(null);
                  await reload();
                }}
                onProject={async (p) => {
                  await updateProject(db, projectId, p);
                  await reload();
                }}
                onSnap={setSnap}
                onGrid={setGridMm}
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
      <View style={[styles.bar, { borderTopColor: theme.backgroundElement, backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 8) }]}>
        {(['add', 'align', 'layers', 'sheet'] as const).map((p) => (
          <Pressable key={p} testID={`bar-${p}`} accessibilityRole="button" accessibilityState={{ selected: panel === p }} onPress={() => setPanel(panel === p ? null : p)} style={styles.barItem}>
            <Text style={[styles.barText, { color: panel === p ? theme.tint : theme.text }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.6}>{t(`bar.${p}` as TranslationKey)}</Text>
          </Pressable>
        ))}
        {selected ? (
          <Pressable testID="bar-edit" accessibilityRole="button" onPress={() => setPanel(panel === 'inspector' ? null : 'inspector')} style={styles.barItem}>
            <Text style={[styles.barText, { color: panel === 'inspector' ? theme.tint : theme.text }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.6}>{t('bar.edit')}</Text>
          </Pressable>
        ) : null}
      </View>
      {question?.kind === 'svg' ? (
        <SvgUnitsModal
          asset={question.asset}
          prefs={prefs}
          onCancel={cancelQuestion}
          onPlace={async (ppi) => {
            const q = question;
            setQuestion(null);
            await setSvgPxPerIn(db, q.asset.id, ppi);
            await place({ ...q.asset, svgPxPerIn: ppi }, [0], q.target, q.env);
          }}
        />
      ) : null}
      {question?.kind === 'pdf' ? (
        <PdfPagesModal
          asset={question.asset}
          prefs={prefs}
          onCancel={cancelQuestion}
          onPlace={async (pages) => {
            const q = question;
            setQuestion(null);
            await place(q.asset, pages, q.target, q.env);
          }}
        />
      ) : null}
      {known && selected && naturalSelected && isAssetObject(selected) ? (
        <KnownLengthModal
          o={selected}
          natural={naturalSelected}
          href={selected.assetId != null ? (previews[previewKey(selected.assetId, selected.pageIndex)] ?? null) : null}
          prefs={prefs}
          onCancel={() => setKnown(false)}
          onApply={(box) => {
            setKnown(false);
            patch(selected.id, box);
            void autosave.flush();
          }}
        />
      ) : null}
      <BusyOverlay text={busy?.text ?? null} detail={busy?.detail} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerButton: { fontSize: 17, fontWeight: '600' },
  chip: { marginHorizontal: 12, marginVertical: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  chipText: { fontSize: 14, fontWeight: '500' },
  error: { marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: 8 },
  errorText: { color: '#fff', fontSize: 14 },
  panelWrap: { maxHeight: '48%' },
  panel: { flexGrow: 0 },
  panelContent: { padding: 12 },
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  barItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  barText: { fontSize: 15, fontWeight: '600' },
});
