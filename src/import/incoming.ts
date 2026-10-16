// Files that arrive from outside (V15_PLAN F20 open-in / share-into-app, X08 display names; phase A1): which URLs are
// files, what kind a file is (PDF, SVG, .svgz, pictures, DXF, .makerprint), what the app does with it, and the name it
// shows. Pure; the native parts (document types, intent filters, Android's display-name lookup) are phase A2.
import { fileKind } from '@/editor/filekind';

import type { AssetKind } from './assets';

export type IncomingKind = 'pdf' | 'svg' | 'image' | 'dxf' | 'archive';
export type Sniffed = { kind: IncomingKind; convert: boolean };

/** The app's own project archive (phase D writes and reads it; a ZIP in store mode). */
export const ARCHIVE_EXTENSION = '.makerprint';
const DXF_MIMES = ['image/vnd.dxf', 'image/x-dxf', 'application/dxf', 'application/x-dxf', 'image/dxf'];

function ascii(b: Uint8Array, from: number, n: number): string {
  let s = '';
  for (let i = from; i < Math.min(b.length, from + n); i++) s += String.fromCharCode(b[i]);
  return s;
}

/** DXF by content: binary sentinel, or an ASCII file starting with group code 0 SECTION (999 comment allowed). */
export function looksLikeDxf(head: Uint8Array): boolean {
  if (ascii(head, 0, 18) === 'AutoCAD Binary DXF') return true;
  const text = ascii(head, 0, 256).replace(/^﻿|^\xEF\xBB\xBF/, '');
  return /^\s*(999\s*\r?\n[^\n]*\r?\n\s*)?0\s*\r?\nSECTION\s*\r?\n/.test(text);
}

/**
 * What an incoming file is, by its first bytes, then its name and MIME type (`head` = the first ≥ 256 bytes for DXF
 * detection; 32 suffice for the others). A ZIP is an archive only with the `.makerprint` name. Null = unknown.
 */
export function sniffIncoming(head: Uint8Array, name: string, mime?: string | null): Sniffed | null {
  const n = name.toLowerCase();
  const m = (mime ?? '').toLowerCase();
  if (ascii(head, 0, 4) === 'PK\x03\x04') return n.endsWith(ARCHIVE_EXTENSION) ? { kind: 'archive', convert: false } : null;
  if (looksLikeDxf(head)) return { kind: 'dxf', convert: false };
  // content first (a PDF named .dxf is a PDF), then a DXF name/MIME (DXF's MIME types start with image/), then the rest
  const byBytes = fileKind(head, '', null);
  if (byBytes) return byBytes;
  if (n.endsWith('.dxf') || DXF_MIMES.includes(m)) return { kind: 'dxf', convert: false };
  const byName = fileKind(head, name, mime);
  if (byName) return byName;
  if (n.endsWith(ARCHIVE_EXTENSION)) return { kind: 'archive', convert: false };
  return null;
}

export type IncomingRefusal =
  /** DXF import is V15 phase F */
  | 'dxfNotYet'
  /** project archives are V15 phase D */
  | 'archiveNotYet'
  | 'unsupportedType';
export type IncomingDecision = { action: 'import'; kind: AssetKind; convert: boolean } | { action: 'refuse'; error: IncomingRefusal };

/** What the app does with a sniffed file today (DXF and archives are recognised and said, not silently ignored). */
export function decideIncoming(s: Sniffed | null): IncomingDecision {
  if (!s) return { action: 'refuse', error: 'unsupportedType' };
  if (s.kind === 'dxf') return { action: 'refuse', error: 'dxfNotYet' };
  if (s.kind === 'archive') return { action: 'refuse', error: 'archiveNotYet' };
  return { action: 'import', kind: s.kind, convert: s.convert };
}

/** Bytes `routeFile` needs from the start of a file (DXF's header can follow a 999 comment line). */
export const SNIFF_BYTES = 512;

/**
 * One answer for a file however it arrived — document picker, photo picker, open-in or share (review S6, D92): the
 * picker path calls this too, so a DXF picked from Files says "not yet" instead of "unsupported format" or an SVG error.
 */
export function routeFile(head: Uint8Array, name: string, mime?: string | null): IncomingDecision {
  return decideIncoming(sniffIncoming(head.subarray(0, SNIFF_BYTES), name, mime));
}

// ------------------------------------------------------------------------------------------------ URLs
export type IncomingUrl =
  /** the app's own links (makerprint://…): Expo Router handles them */
  | { type: 'deeplink'; path: string }
  /** a file given to the app: iOS "Open in" (file://…/Inbox/…), Android VIEW/SEND (content://, file://) */
  | { type: 'file'; uri: string; nameHint: string | null }
  | { type: 'unsupported' };

/**
 * Classifies a URL the system opened the app with. `appSchemes` = the variant's own scheme(s). Web links are not
 * handled (the app is offline and declares none); anything else unknown is `unsupported`.
 */
export function parseIncomingUrl(url: string, appSchemes: readonly string[]): IncomingUrl {
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(url.trim());
  if (!m) return url.startsWith('/') ? { type: 'deeplink', path: url } : { type: 'unsupported' };
  const scheme = m[1].toLowerCase();
  if (appSchemes.map((s) => s.toLowerCase()).includes(scheme)) {
    const rest = m[2].replace(/^\/\//, '');
    return { type: 'deeplink', path: `/${rest.replace(/^\/+/, '')}` };
  }
  if (scheme === 'file' || scheme === 'content') return { type: 'file', uri: url.trim(), nameHint: nameFromUri(url) };
  return { type: 'unsupported' };
}

/** For Expo Router's `+native-intent` `redirectSystemPath`: app links pass through, a file goes to the projects list. */
export function nativeIntentRedirect(path: string, appSchemes: readonly string[]): { path: string; incoming: IncomingUrl | null } {
  const u = parseIncomingUrl(path, appSchemes);
  if (u.type === 'deeplink') return { path: u.path, incoming: null };
  return { path: '/', incoming: u };
}

/** Files waiting for the projects screen (handed over from the native-intent hook; in memory, one app process). */
const pending: IncomingUrl[] = [];
export function queueIncoming(u: IncomingUrl): void {
  if (u.type === 'file' && !pending.some((p) => p.type === 'file' && p.uri === u.uri)) pending.push(u);
}
export function takeIncoming(): IncomingUrl[] {
  return pending.splice(0, pending.length);
}

/** The last path segment, percent-decoded (Android document ids such as "image:34" keep the part after ":"). */
export function nameFromUri(uri: string): string | null {
  const path = uri.replace(/[?#].*$/, '');
  const seg = path.split('/').filter(Boolean).pop();
  if (!seg) return null;
  let name: string;
  try {
    name = decodeURIComponent(seg);
  } catch {
    name = seg;
  }
  name = name.split('/').pop() ?? name;
  if (/^[\w-]+:/.test(name) && !/^[a-z]:[\\/]/i.test(name)) name = name.slice(name.indexOf(':') + 1);
  name = name.split('/').pop() ?? name;
  return name.trim() || null;
}

// ------------------------------------------------------------------------------------------------ display names
const EXT_FOR: Record<string, string> = { pdf: '.pdf', svg: '.svg', jpeg: '.jpg', png: '.png', dxf: '.dxf', archive: ARCHIVE_EXTENSION };
const IMAGE_EXT = /^\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A name that tells the user nothing: digits only (Android "34"), a UUID (iOS camera), a picker temp name, empty. */
export function isMeaninglessName(name: string): boolean {
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, '').trim();
  if (!stem || /^\.+$/.test(stem)) return true; // review N6: ".." would become "...pdf"
  if (/^\d+$/.test(stem)) return true;
  if (UUID.test(stem)) return true;
  if (/^(image|video|document|msf|raw|primary|media)[:_-]?\d*$/i.test(stem)) return true;
  if (/^(ImagePicker|DocumentPicker)$/i.test(stem)) return true;
  return false;
}

/** Strips folders, control and reserved characters; at most 120 characters, keeping the extension. */
export function cleanName(name: string): string {
  let n = name.split(/[\\/]/).pop() ?? '';
  // control, reserved and (review N6) bidirectional/invisible format characters (U+202E shows "a‮gpj.exe" reversed)
  n = n.replace(/[\u0000-\u001f\u007f:*?"<>|\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.length > 120) {
    const ext = /\.[a-z0-9]{1,10}$/i.exec(n)?.[0] ?? '';
    n = n.slice(0, 120 - ext.length).trimEnd() + ext;
  }
  return n;
}

/**
 * The name shown for an incoming or picked file (X08): the first meaningful of the native display name (Android
 * ContentResolver), the picker's file name, the URI's last segment; else `fallbackStem` (e.g. "Photo 2026-10-16 11.58").
 * The extension is made to match what the file IS (`kind`: 'pdf' | 'svg' | 'jpeg' | 'png' | 'dxf' | 'archive').
 */
export function displayName(c: { resolved?: string | null; picked?: string | null; uri?: string | null; kind: keyof typeof EXT_FOR | null; fallbackStem: string }): string {
  const candidates = [c.resolved, c.picked, c.uri ? nameFromUri(c.uri) : null].map((s) => (s ? cleanName(s) : '')).filter((s) => s && !isMeaninglessName(s));
  let name = candidates[0] ?? cleanName(c.fallbackStem);
  if (!name) name = 'file';
  const ext = c.kind ? EXT_FOR[c.kind] : null;
  if (ext) {
    const has = /\.[a-z0-9]{1,10}$/i.exec(name)?.[0].toLowerCase() ?? '';
    const same = has === ext || (ext === '.jpg' && has === '.jpeg');
    // a picture converted by the platform (HEIC → JPEG) or misnamed: the picture extension is replaced, others kept
    if (!same && (ext === '.jpg' || ext === '.png') && IMAGE_EXT.test(has)) name = name.slice(0, -has.length) + ext;
    else if (!same && ext === '.svg' && /^\.(svgz|gz)$/.test(has)) name = name.replace(/(\.svg)?\.(svgz|gz)$/i, '') + ext;
    else if (!same) name = `${name}${ext}`;
  }
  return name;
}

/** "2026-10-16 11.58" (no ":" — file names on every platform). */
export function stampForName(d: Date): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}
