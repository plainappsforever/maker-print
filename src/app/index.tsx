// Projects (SPEC §9.1): a two-column grid of page tiles with crop marks (thumbnail, name, sheet size, sheets, last edited),
// a floating New button, tile actions Rename / Duplicate / Delete, the "Calibrate your printer once" banner and Settings.
// No dialog at first launch (L10). Redesign R1: graph-paper background, drawn empty state.
import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';
import { Radius } from '@/constants/theme';
import { Text, TextInput } from '@/components/text';
import { useSQLiteContext } from '@/db/provider';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Svg, { G } from 'react-native-svg';

import { Button } from '@/components/button';
import { CropMarks } from '@/components/crop-marks';
import { EmptyTile } from '@/components/empty-tile';
import { GridBackdrop } from '@/components/grid-backdrop';
import { paperLabel } from '@/components/editor-panels';
import { BusyOverlay, nextFrame, type UnitPrefs } from '@/components/fields';
import { NewProjectSheet, type NewChoice } from '@/components/new-project';
import { SheetGraphic } from '@/components/sheet-graphic';
import { addObject } from '@/db/objects';
import { createProject, deleteProject, duplicateProject, listProjects, updateProject, type ProjectSummary } from '@/db/projects';
import { getAppSettings, setAppSetting, type AppSettings } from '@/db/settings';
import { SLOW_IMPORT_BYTES } from '@/editor/filekind';
import { effectiveMargins, type ProjectDoc } from '@/editor/output';
import { templateProject } from '@/editor/templates';
import type { GenContext } from '@/engine/generators';
import { paperSize } from '@/engine/paper';
import { formatLength } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { getUiLanguage, printTranslator, t, type TranslationKey } from '@/i18n';
import { loadProjectDoc, previewUris } from '@/lib/doc';
import { copyDocumentFiles, removeProjectFolder } from '@/lib/files';
import { pickFile, prepareImport, storeAsset } from '@/lib/import';
import { deviceRegion } from '@/lib/locale';

export default function ProjectsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const lang = getUiLanguage();
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 3 : 2;
  const tileSize = Math.floor((width - PAD * 2 - GUTTER * (columns - 1)) / columns);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [actions, setActions] = useState<ProjectSummary | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ text: string; detail: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSettings(await getAppSettings(db, deviceRegion()));
    setProjects(await listProjects(db));
  }, [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const prefs: UnitPrefs = { unit: settings?.units ?? 'mm', inchStyle: settings?.inchStyle ?? 'fraction16', locale: lang };
  const open = (id: number, pending?: number) => router.push({ pathname: '/project/[id]', params: pending ? { id: String(id), pending: String(pending) } : { id: String(id) } });

  async function create(c: NewChoice) {
    setShowNew(false);
    if (!settings) return;
    const fmt = (mm: number) => formatLength(mm, { ...prefs, withUnit: false });
    if (c.kind === 'blank') {
      const s = paperSize(c.paperKey, c.landscape ? 'landscape' : 'portrait');
      const name = t('new.blankName', { paper: paperLabel(c.paperKey) });
      const { projectId } = await createProject(db, { name, paperKey: c.paperKey, sheet: { widthMm: s.w, heightMm: s.h, paperKey: c.paperKey } });
      return open(projectId);
    }
    if (c.kind === 'big') {
      const name = t('new.bigName', { size: `${fmt(c.widthMm)} × ${formatLength(c.heightMm, prefs)}` });
      const { projectId } = await createProject(db, { name, paperKey: settings.defaultPaper, sheet: { widthMm: c.widthMm, heightMm: c.heightMm, paperKey: null } });
      return open(projectId);
    }
    if (c.kind === 'template') {
      const margins = effectiveMargins({ marginMm: null, paperKey: c.params.paperKey }, null, settings);
      const tp = templateProject(c.template, c.params, margins);
      const detail = c.template === 'ruler' ? formatLength(c.params.lengthMm, prefs) : c.template === 'grid' || c.template === 'dots' || c.template === 'lines' ? formatLength(c.params.spacingMm, prefs) : '';
      const name = `${t(`template.${c.template}` as TranslationKey)}${detail ? ` ${detail}` : ''}`;
      const { projectId, sheetId } = await createProject(db, { name, paperKey: c.params.paperKey, sheet: tp.sheet });
      await addObject(db, sheetId, { ...tp.object, name: '' });
      return open(projectId);
    }
    // Open file: pick → read and check (busy) → new project → stored asset → the editor asks its questions and places it
    // iOS cannot present the picker while the New sheet is still sliding away
    if (Platform.OS === 'ios') await new Promise((r) => setTimeout(r, 600));
    const picked = await pickFile();
    if (!picked) return;
    setError(null);
    setBusy({ text: t('import.reading'), detail: (picked.size ?? 0) > SLOW_IMPORT_BYTES ? t('import.slow') : null });
    await nextFrame();
    try {
      const r = await prepareImport(picked, [lang]);
      if (!r.ok) return setError(t(`import.error.${r.error}` as TranslationKey));
      const name = picked.name.replace(/\.[^.]+$/, '') || picked.name;
      const { projectId } = await createProject(db, { name, paperKey: settings.defaultPaper });
      const asset = await storeAsset(db, projectId, r.file, [lang]);
      open(projectId, asset.id);
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(p: ProjectSummary) {
    setActions(null);
    const r = await duplicateProject(db, p.id, { name: t('projects.copyName', { name: p.name }), assetFile: (old, newId) => `assets/${newId}/${old.split('/').pop()}` });
    try {
      await copyDocumentFiles(r.copies);
    } catch (e) {
      // a copy that failed half-way (disk full) would print without its imported files: take the new copy back, say why
      // (REVIEW_V1 finding 21); the original project is untouched
      await deleteProject(db, r.projectId);
      removeProjectFolder(r.projectId);
      Alert.alert(t('projects.duplicateFailed'), String((e as Error)?.message ?? e));
    }
    await load();
  }

  function confirmDelete(p: ProjectSummary) {
    setActions(null);
    Alert.alert(t('projects.deleteTitle', { name: p.name }), t('projects.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('projects.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteProject(db, p.id);
          removeProjectFolder(p.id);
          await load();
        },
      },
    ]);
  }

  async function saveName() {
    if (!actions || !rename?.trim()) return;
    await updateProject(db, actions.id, { name: rename });
    setRename(null);
    setActions(null);
    await load();
  }

  const banner = settings && !settings.calibrationBannerDismissed;
  return (
    <View testID="projects-screen" style={[styles.flex, { backgroundColor: theme.background }]}>
      <GridBackdrop />
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel={t('nav.settings')} hitSlop={10}>
                <SymbolView name="gearshape" size={22} tintColor={theme.tintText} fallback={<Text style={[styles.headerButton, { color: theme.tintText }]}>⚙︎</Text>} />
              </Pressable>
            </Link>
          ),
        }}
      />
      {banner ? (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
          <CropMarks length={8} inset={3} />
          <Link href="/calibrate" asChild>
            <Pressable testID="open-calibrate" accessibilityRole="link" style={styles.flex}>
              <Text style={[styles.bannerText, { color: theme.text }]}>{t('projects.calibrateBanner')}</Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>{t('projects.calibrateWhy')}</Text>
            </Pressable>
          </Link>
          <Pressable
            testID="banner-dismiss"
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            hitSlop={10}
            onPress={async () => {
              await setAppSetting(db, 'calibrationBannerDismissed', true);
              await load();
            }}>
            <Text style={[styles.close, { color: theme.textSecondary }]}>✕</Text>
          </Pressable>
        </View>
      ) : (
        <Link href="/calibrate" asChild>
          <Pressable testID="open-calibrate" accessibilityRole="link" style={styles.calLink}>
            <Text style={[styles.small, { color: theme.tintText }]}>{t('nav.calibrate')}</Text>
          </Pressable>
        </Link>
      )}
      {error ? (
        <Pressable testID="import-error" onPress={() => setError(null)} style={[styles.error, { backgroundColor: theme.danger }]}>
          <Text style={[styles.errorText, { color: theme.onTint }]}>{error}</Text>
        </Pressable>
      ) : null}
      <FlatList
        key={columns}
        data={projects ?? []}
        numColumns={columns}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        ListEmptyComponent={
          projects ? (
            <View style={styles.emptyWrap}>
              <EmptyTile size={Math.min(tileSize, 200)} />
              <Text testID="projects-empty" style={[styles.empty, { color: theme.textSecondary }]}>
                {t('projects.empty')}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => <ProjectTile p={item} index={index} size={tileSize} prefs={prefs} onOpen={() => open(item.id)} onMore={() => setActions(item)} />}
      />
      <Pressable
        testID="new-project"
        accessibilityRole="button"
        accessibilityLabel={t('projects.new')}
        onPress={() => setShowNew(true)}
        style={({ pressed }) => [styles.fab, { backgroundColor: theme.tint, opacity: pressed ? 0.8 : 1 }]}>
        <SymbolView name="plus" size={18} weight="semibold" tintColor={theme.onTint} fallback={<Text style={[styles.fabPlus, { color: theme.onTint }]}>+</Text>} />
        <Text style={[styles.fabLabel, { color: theme.onTint }]}>{t('projects.new')}</Text>
      </Pressable>
      {settings ? <NewProjectSheet visible={showNew} defaultPaper={settings.defaultPaper} prefs={prefs} onChoose={(c) => void create(c)} onClose={() => setShowNew(false)} /> : null}
      <Modal visible={actions !== null} transparent animationType="fade" onRequestClose={() => setActions(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable style={styles.scrim} accessible={false} onPress={() => setActions(null)}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]} onStartShouldSetResponder={() => true}>
            {actions && rename !== null ? (
              <>
                <TextInput
                  testID="rename-field"
                  value={rename}
                  onChangeText={setRename}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => void saveName()}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <Button label={t('common.save')} testID="rename-save" disabled={!rename.trim()} onPress={() => void saveName()} />
              </>
            ) : actions ? (
              <>
                <Text style={[styles.sheetTitle, { color: theme.text }]} numberOfLines={1}>
                  {actions.name}
                </Text>
                <Button label={t('projects.rename')} testID="action-rename" variant="secondary" onPress={() => setRename(actions.name)} />
                <Button label={t('projects.duplicate')} testID="action-duplicate" variant="secondary" onPress={() => void duplicate(actions)} />
                <Button label={t('projects.delete')} testID="action-delete" variant="secondary" onPress={() => confirmDelete(actions)} />
              </>
            ) : null}
          </View>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      <BusyOverlay text={busy?.text ?? null} detail={busy?.detail} />
    </View>
  );
}

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return t('time.now');
  if (min < 60) return t('time.min', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('time.h', { n: h });
  return new Date(ms).toLocaleDateString(getUiLanguage() === 'de' ? 'de-DE' : 'en-GB');
}

function ProjectTile({ p, index, size, prefs, onOpen, onMore }: { p: ProjectSummary; index: number; size: number; prefs: UnitPrefs; onOpen: () => void; onMore: () => void }) {
  const theme = useTheme();
  const info = `${formatLength(p.widthMm, { ...prefs, withUnit: false })} × ${formatLength(p.heightMm, prefs)}${p.sheetCount > 1 ? ` · ${t('projects.sheets', { n: p.sheetCount })}` : ''}`;
  return (
    <View style={{ width: size }}>
      <Pressable testID={`project-${index}`} accessibilityRole="button" onPress={onOpen}>
        <View style={[styles.tile, { width: size, height: size, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Thumbnail projectId={p.id} updatedAt={p.updatedAt} w={p.widthMm} h={p.heightMm} box={size - 36} />
          <CropMarks length={10} inset={6} />
        </View>
        <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={[styles.small, { color: theme.textSecondary, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>
          {info}
        </Text>
        <Text style={[styles.small, { color: theme.textSecondary }]}>{ago(p.updatedAt)}</Text>
      </Pressable>
      <Pressable testID={`project-more-${index}`} accessibilityRole="button" accessibilityLabel={t('projects.more')} onPress={onMore} hitSlop={6} style={styles.more}>
        <Text style={[styles.moreText, { color: theme.textSecondary }]}>⋯</Text>
      </Pressable>
    </View>
  );
}

const PAD = 16;
const GUTTER = 10;
/** First sheet drawn small with its objects (no thumbnail files to keep in sync). */
function Thumbnail({ projectId, updatedAt, w, h, box }: { projectId: number; updatedAt: number; w: number; h: number; box: number }) {
  const db = useSQLiteContext();
  const [state, setState] = useState<{ doc: ProjectDoc; previews: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    loadProjectDoc(db, projectId).then(async (doc) => {
      if (doc && alive) setState({ doc, previews: await previewUris(doc) });
    });
    return () => {
      alive = false;
    };
  }, [db, projectId, updatedAt]);
  const k = Math.min(box / w, box / h);
  const ctx: GenContext = { locale: getUiLanguage(), unit: 'mm', inchStyle: 'fraction16', t: printTranslator(getUiLanguage()) };
  const sheet = state?.doc.sheets[0];
  return (
    <View style={[styles.thumb, { width: box, height: box }]}>
      <Svg width={box} height={box}>
        <G transform={[k, 0, 0, k, (box - w * k) / 2, (box - h * k) / 2]}>
          {sheet ? (
            <SheetGraphic
              sheet={sheet}
              objects={state.doc.objects.filter((o) => o.sheetId === sheet.id)}
              assets={new Map(state.doc.assets.map((a) => [a.id, a]))}
              previews={state.previews}
              ctx={ctx}
              scale={k}
              margins={null}
              showBadges={false}
            />
          ) : null}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerButton: { fontSize: 22 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: PAD, marginBottom: 0, paddingVertical: 14, paddingHorizontal: 16 },
  bannerText: { fontSize: 16, fontWeight: '600' },
  close: { fontSize: 18, padding: 4 },
  calLink: { paddingHorizontal: PAD, paddingVertical: 8, alignSelf: 'flex-start' },
  small: { fontSize: 13 },
  error: { margin: 12, marginBottom: 0, padding: 10, borderRadius: Radius.control },
  errorText: { fontSize: 14 },
  list: { padding: PAD, paddingBottom: 110, gap: 14 },
  row: { gap: GUTTER },
  emptyWrap: { alignItems: 'center', gap: 20, marginTop: 40, paddingHorizontal: 24 },
  empty: { fontSize: 16, textAlign: 'center' },
  fab: { position: 'absolute', right: PAD, bottom: PAD + 8, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 20, borderRadius: 26, boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.25)' },
  fabPlus: { fontSize: 22, fontWeight: '600' },
  fabLabel: { fontSize: 16, fontWeight: '600' },
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  more: { position: 'absolute', top: 6, right: 6, width: 32, height: 28, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 22, fontWeight: '700' },
  thumb: { overflow: 'hidden' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { padding: 20, paddingBottom: 40, gap: 10, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  input: { minHeight: 44, borderRadius: Radius.control, paddingHorizontal: 10, fontSize: 16 },
});
