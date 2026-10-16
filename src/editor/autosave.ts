// Editor autosave (V1_PLAN "UI structure", L10 "every edit autosaves; Back never loses work"): object patches are
// merged per object and written through the queue (`updateObject` → withTransaction) after `delayMs` of quiet, or at
// once on `flush()` (gesture release, leaving the screen, app going to the background). Pure apart from timers.
export type Patch = Record<string, unknown>;
export type Writer = (id: number, patch: Patch) => Promise<void>;

export class Autosave {
  private pending = new Map<number, Patch>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failed: unknown = null;

  private readonly write: Writer;
  private readonly delayMs: number;
  private readonly onError: (e: unknown) => void;

  // no constructor parameter properties: src/ stays Node strip-only compatible (CLAUDE.md)
  constructor(write: Writer, delayMs = 250, onError: (e: unknown) => void = () => undefined) {
    this.write = write;
    this.delayMs = delayMs;
    this.onError = onError;
  }

  /** Merges `patch` into the object's pending patch and (re)starts the quiet timer. */
  schedule(id: number, patch: Patch): void {
    this.pending.set(id, { ...(this.pending.get(id) ?? {}), ...patch });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Drops a pending patch (the object was deleted). */
  forget(id: number): void {
    this.pending.delete(id);
  }

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  get lastError(): unknown {
    return this.failed;
  }

  /** Writes every pending patch now, in order; resolves when they (and earlier flushes) are written. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, patch] of batch) {
      this.chain = this.chain.then(() =>
        this.write(id, patch).catch((e) => {
          this.failed = e;
          this.onError(e);
        })
      );
    }
    return this.chain;
  }
}
