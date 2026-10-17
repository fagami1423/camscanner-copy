/**
 * Tracks the one capture that may be in flight (the shutter or auto-fire waiting on the camera),
 * so leaving the camera screen can wait for it before deciding the document is empty.
 */
export interface ShotTracker {
  /** Starts `shot` unless one is already in flight; returns whether it started. */
  run(shot: () => Promise<void>): boolean;
  busy(): boolean;
  /** Resolves once no shot is in flight; never rejects. */
  idle(): Promise<void>;
}

export function createShotTracker(onSettled: () => void = () => {}): ShotTracker {
  let current: Promise<void> | null = null;
  return {
    run(shot) {
      if (current) return false;
      current = shot()
        .catch(() => {}) // the caller reports its own errors
        .finally(() => {
          current = null;
          onSettled();
        });
      return true;
    },
    busy: () => current !== null,
    idle: () => current ?? Promise.resolve(),
  };
}
