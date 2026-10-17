import type { CvState } from '../cv/client';

export const RAW_FALLBACK_MESSAGE = (n: number) =>
  `${n} captured page(s) could not be processed — scanner engine failed to load`;

/** `T`: one capture (a Blob, or a Blob plus per-capture data such as the live-quad hint). */
export interface CaptureQueueDeps<T> {
  /** Full pipeline (detect/warp/enhance); needs CV. */
  saveProcessed: (item: T) => Promise<void>;
  /** Unprocessed fallback used once CV has failed. */
  saveRaw: (item: T) => Promise<void>;
  onSaved: () => void;
  /** Captures still waiting to be processed (0 once CV has failed: they are no longer "processing"). */
  onPending: (n: number) => void;
  onSaveError: (err: unknown) => void;
  notify: (msg: string) => void;
}

export interface CaptureQueue<T = Blob> {
  push(items: T[]): void;
  setCvState(s: CvState): void;
  pending(): number;
  /** Drops captures not yet being saved (the in-flight one still completes). Returns how many. */
  discard(): number;
  idle(): Promise<void>;
}

/**
 * FIFO of captured images. Holds them while CV is loading, saves them processed (in order) when CV
 * is ready, and falls back to unprocessed saves if CV fails, so no capture is lost.
 */
export function createCaptureQueue<T = Blob>(deps: CaptureQueueDeps<T>): CaptureQueue<T> {
  const queue: T[] = [];
  let state: CvState = 'loading';
  let running: Promise<void> | null = null;

  const report = () => deps.onPending(state === 'error' ? 0 : queue.length);

  async function drain(): Promise<void> {
    while (queue.length && state !== 'loading') {
      const raw = state === 'error';
      try {
        await (raw ? deps.saveRaw(queue[0]) : deps.saveProcessed(queue[0]));
        deps.onSaved();
      } catch (e) {
        if (!raw && state === 'error') continue; // CV died mid-save: retry this capture unprocessed
        deps.onSaveError(e);
      }
      queue.shift();
      report();
    }
  }

  function kick() {
    if (running || state === 'loading' || !queue.length) return;
    running = drain().finally(() => {
      running = null;
      kick(); // anything pushed between the loop's exit and here
    });
  }

  return {
    push(items) {
      if (!items.length) return;
      queue.push(...items);
      report();
      kick();
    },
    setCvState(s) {
      if (s === state) return;
      state = s;
      if (s === 'error' && queue.length) deps.notify(RAW_FALLBACK_MESSAGE(queue.length));
      report();
      kick();
    },
    pending: () => queue.length,
    discard() {
      const keep = running ? 1 : 0; // queue[0] is being saved while drain() runs
      const dropped = queue.splice(keep).length;
      if (dropped) report();
      return dropped;
    },
    async idle() {
      while (running) await running;
    },
  };
}
