// File glue for output PDFs (expo-file-system v57 `File`/`Paths`). Output PDFs go to the cache directory: they are
// regenerated from the project for every print, never the only copy of anything.
import { Directory, File, Paths } from 'expo-file-system';

const outDir = () => {
  const d = new Directory(Paths.cache, 'print');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
};

/** Writes bytes to cache/print/<name> (replacing an older file of that name) and returns its file:// URI. */
export function writeOutputPdf(name: string, bytes: Uint8Array): string {
  const f = new File(outDir(), name.replace(/[^\w.-]+/g, '_'));
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  return f.uri;
}

/** Document-directory file (kept across launches): debug results the Mac pulls from the simulator/emulator. */
export function writeDocumentText(name: string, text: string): string {
  const f = new File(Paths.document, name);
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  return f.uri;
}

export function readFileBytes(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}

// ------------------------------------------------------------------------------------------------ project assets (D19)
// Imported files are copied to Paths.document/assets/<projectId>/ and referenced relative to Paths.document, so the
// app container may move (iOS updates) without breaking paths. Preview copies (editor only, ≤ 2048 px) sit next to
// the original as "<file>.preview.<ext>"; output always uses the original.

const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'file';

export const projectAssetFolder = (projectId: number) => `assets/${projectId}`;

/** Absolute file:// URI of a stored relative path. */
export const documentUri = (rel: string) => new File(Paths.document, rel).uri;

export function documentFileExists(rel: string): boolean {
  return new File(Paths.document, rel).exists;
}

/** Writes `bytes` as a new asset file of the project; returns its path relative to Paths.document. */
export function writeProjectAsset(projectId: number, originalName: string, bytes: Uint8Array): string {
  const dir = new Directory(Paths.document, projectAssetFolder(projectId));
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const rel = `${projectAssetFolder(projectId)}/${Date.now().toString(36)}-${safeName(originalName)}`;
  const f = new File(Paths.document, rel);
  f.create();
  f.write(bytes);
  return rel;
}

/** Copies an existing file (e.g. a converted or preview image in the cache) to a relative document path. */
export async function copyToDocument(fromUri: string, rel: string): Promise<void> {
  const to = new File(Paths.document, rel);
  if (to.exists) to.delete();
  const dir = new Directory(Paths.document, rel.split('/').slice(0, -1).join('/'));
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  await new File(fromUri).copy(to);
}

export const previewRel = (rel: string, ext: 'jpg' | 'png') => `${rel}.preview.${ext}`;

/** The user's own data after a confirmed project delete (SPEC §7, D19): the project's asset folder. */
export function removeProjectFolder(projectId: number): void {
  const dir = new Directory(Paths.document, projectAssetFolder(projectId));
  if (dir.exists) dir.delete();
}

/** Duplicate project: copy each asset file (and its preview copies when present). */
export async function copyDocumentFiles(copies: { from: string; to: string }[]): Promise<void> {
  for (const c of copies) {
    await copyToDocument(new File(Paths.document, c.from).uri, c.to);
    for (const [from, to] of [[previewRel(c.from, 'jpg'), previewRel(c.to, 'jpg')], [previewRel(c.from, 'png'), previewRel(c.to, 'png')], [`${c.from}.p0.png`, `${c.to}.p0.png`]]) {
      const p = new File(Paths.document, from);
      if (p.exists) await copyToDocument(p.uri, to);
    }
  }
}

/** Size of a picked file without reading it (null when the platform cannot tell). */
export function fileSize(uri: string): number | null {
  try {
    return new File(uri).size;
  } catch {
    return null;
  }
}

/** An asset file (and its previews) of an import the user cancelled. */
export function removeDocumentFiles(rel: string): void {
  for (const r of [rel, previewRel(rel, 'jpg'), previewRel(rel, 'png'), `${rel}.p0.png`]) {
    const f = new File(Paths.document, r);
    if (f.exists) f.delete();
  }
}
