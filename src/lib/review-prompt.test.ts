/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { openDatabase } from '@/db/migrations';
import { getSetting } from '@/db/settings';

import { recordFinishedJob, REVIEW_AFTER_JOBS, type ReviewDeps } from './review-prompt';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.0' } } }));
jest.mock('expo-store-review', () => ({ isAvailableAsync: jest.fn(), requestReview: jest.fn() }));

async function freshDb() {
  const db = createTestDb();
  await openDatabase(db);
  return db;
}
function deps(version: string, available = true) {
  const request = jest.fn(async () => {});
  const d: ReviewDeps = { version, isAvailable: async () => available, request };
  return { d, request };
}

test('asks only at the third finished job, not before', async () => {
  const db = await freshDb();
  const { d, request } = deps('1.2.0');
  expect(REVIEW_AFTER_JOBS).toBe(3);
  expect(await recordFinishedJob(db, d)).toBe(false);
  expect(await recordFinishedJob(db, d)).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(await recordFinishedJob(db, d)).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});

test('at most once per app version, again after an update', async () => {
  const db = await freshDb();
  const a = deps('1.2.0');
  for (let i = 0; i < 6; i++) await recordFinishedJob(db, a.d);
  expect(a.request).toHaveBeenCalledTimes(1);
  const b = deps('1.3.0');
  expect(await recordFinishedJob(db, b.d)).toBe(true);
  expect(b.request).toHaveBeenCalledTimes(1);
});

test('no prompt and no flag when the system says it is unavailable', async () => {
  const db = await freshDb();
  const { d, request } = deps('1.2.0', false);
  for (let i = 0; i < 4; i++) expect(await recordFinishedJob(db, d)).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(await getSetting(db, 'review_asked_version')).toBeNull();
});

test('a failing request never throws', async () => {
  const db = await freshDb();
  const d: ReviewDeps = { version: '1.2.0', isAvailable: async () => true, request: async () => { throw new Error('x'); } };
  for (let i = 0; i < 3; i++) await expect(recordFinishedJob(db, d)).resolves.toBeDefined();
});
