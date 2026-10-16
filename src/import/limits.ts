// Import limits (SPEC §11/§12): bigger files get a message and nothing is imported. Pure.

export const LIMITS = {
  /** bytes per file */
  fileBytes: 50 * 1024 * 1024,
  pdfPages: 200,
  /** pixels per image (width × height) */
  imagePixels: 30_000_000,
  /** photos per batch import (V15 X06; the picker's selection limit, as PtS-PDF's batch of 20) */
  batchPhotos: 20,
} as const;

export type LimitError = 'emptyFile' | 'fileTooLarge';

/** 0-byte and > 50 MB files are refused before parsing. */
export function checkFileBytes(bytes: number): LimitError | null {
  if (!(bytes > 0)) return 'emptyFile';
  if (bytes > LIMITS.fileBytes) return 'fileTooLarge';
  return null;
}

export const tooManyPixels = (w: number, h: number) => w * h > LIMITS.imagePixels;
