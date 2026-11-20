// Rating prompt (redesign R1): ask once the third print or export has finished, never earlier and never more than once
// per app version. The counters live in the settings table; the app has no backup file, so they never leave the device.
import Constants from 'expo-constants';
import * as StoreReview from 'expo-store-review';

import { getSetting, setSetting } from '@/db/settings';
import type { Db } from '@/db/types';

export const REVIEW_AFTER_JOBS = 3;
const COUNT_KEY = 'finished_jobs';
const ASKED_KEY = 'review_asked_version';

export type ReviewDeps = {
  version: string;
  isAvailable: () => Promise<boolean>;
  request: () => Promise<void>;
};

const realDeps = (): ReviewDeps => ({
  version: Constants.expoConfig?.version ?? '0',
  isAvailable: () => StoreReview.isAvailableAsync(),
  request: () => StoreReview.requestReview(),
});

/** Call after a print or export finished. Returns true when the system rating sheet was requested. Never throws. */
export async function recordFinishedJob(db: Db, deps: ReviewDeps = realDeps()): Promise<boolean> {
  try {
    const stored = Number(await getSetting(db, COUNT_KEY));
    const count = (Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0) + 1;
    await setSetting(db, COUNT_KEY, String(count));
    if (count < REVIEW_AFTER_JOBS) return false;
    if ((await getSetting(db, ASKED_KEY)) === deps.version) return false;
    if (!(await deps.isAvailable())) return false;
    await setSetting(db, ASKED_KEY, deps.version);
    await deps.request();
    return true;
  } catch {
    return false;
  }
}
