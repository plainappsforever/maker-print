// Projects (SPEC §9.1): cards (thumbnail, name, sheet size, pages, last edited), New, row actions Rename / Duplicate /
// Delete, the "Calibrate your printer once" banner and Settings. No dialog at first launch (L10).
import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/db/provider';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { G } from 'react-native-svg';

import { Button } from '@/components/button';
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
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel={t('nav.settings')} hitSlop={10}>
                <Text style={[styles.headerButton, { color: theme.tint }]}>⚙︎</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      {banner ? (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
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
            <Text style={[styles.small, { color: theme.tint }]}>{t('nav.calibrate')}</Text>
          </Pressable>
        </Link>
      )}
      {error ? (
        <Pressable testID="import-error" onPress={() => setError(null)} style={[styles.error, { backgroundColor: theme.danger }]}>
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={projects ?? []}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={projects ? <Text style={[styles.empty, { color: theme.textSecondary }]}>{t('projects.empty')}</Text> : null}
        renderItem={({ item, index }) => <ProjectCard p={item} index={index} prefs={prefs} onOpen={() => open(item.id)} onMore={() => setActions(item)} />}
      />
      <View style={styles.footer}>
        <Button label={t('projects.new')} testID="new-project" onPress={() => setShowNew(true)} />
      </View>
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

function ProjectCard({ p, index, prefs, onOpen, onMore }: { p: ProjectSummary; index: number; prefs: UnitPrefs; onOpen: () => void; onMore: () => void }) {
  const theme = useTheme();
  const size = `${formatLength(p.widthMm, { ...prefs, withUnit: false })} × ${formatLength(p.heightMm, prefs)}`;
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <Pressable testID={`project-${index}`} accessibilityRole="button" onPress={onOpen} style={styles.cardMain}>
        <Thumbnail projectId={p.id} updatedAt={p.updatedAt} w={p.widthMm} h={p.heightMm} />
        <View style={styles.flex}>
          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
            {p.name}
          </Text>
          <Text style={[styles.small, { color: theme.textSecondary }]}>
            {size}
            {p.sheetCount > 1 ? ` · ${t('projects.sheets', { n: p.sheetCount })}` : ''}
          </Text>
          <Text style={[styles.small, { color: theme.textSecondary }]}>{ago(p.updatedAt)}</Text>
        </View>
      </Pressable>
      <Pressable testID={`project-more-${index}`} accessibilityRole="button" accessibilityLabel={t('projects.more')} onPress={onMore} hitSlop={10} style={styles.more}>
        <Text style={[styles.moreText, { color: theme.textSecondary }]}>⋯</Text>
      </Pressable>
    </View>
  );
}

const THUMB = 64;
/** First sheet drawn small with its objects (no thumbnail files to keep in sync). */
function Thumbnail({ projectId, updatedAt, w, h }: { projectId: number; updatedAt: number; w: number; h: number }) {
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
  const k = Math.min(THUMB / w, THUMB / h);
  const ctx: GenContext = { locale: getUiLanguage(), unit: 'mm', inchStyle: 'fraction16', t: printTranslator(getUiLanguage()) };
  const sheet = state?.doc.sheets[0];
  return (
    <View style={styles.thumb}>
      <Svg width={THUMB} height={THUMB}>
        <G transform={[k, 0, 0, k, (THUMB - w * k) / 2, (THUMB - h * k) / 2]}>
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
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 0, padding: 12, borderRadius: 12 },
  bannerText: { fontSize: 16, fontWeight: '600' },
  close: { fontSize: 18, padding: 4 },
  calLink: { paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' },
  small: { fontSize: 13 },
  error: { margin: 12, marginBottom: 0, padding: 10, borderRadius: 8 },
  errorText: { color: '#fff', fontSize: 14 },
  list: { padding: 12, gap: 10 },
  empty: { fontSize: 16, textAlign: 'center', marginTop: 40 },
  footer: { padding: 16, paddingBottom: 32, gap: 4 },
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: 12 },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  more: { padding: 14 },
  moreText: { fontSize: 22, fontWeight: '700' },
  thumb: { width: THUMB, height: THUMB, borderRadius: 6, backgroundColor: '#D9DCE1', overflow: 'hidden' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { padding: 20, paddingBottom: 40, gap: 10, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  input: { minHeight: 44, borderRadius: 8, paddingHorizontal: 10, fontSize: 16 },
});
