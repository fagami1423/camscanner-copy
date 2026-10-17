import { StabilityTracker, scaleQuad } from '../cv/geometry';
import type { Quad } from '../types';

export interface AutoCaptureDeps {
  sample: () => { img: ImageData; scale: number } | null;
  detect: (img: ImageData) => Promise<Quad | null>;
  onQuad: (q: Quad | null) => void;
  onFire: () => void;
  enabled: () => boolean;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (id: number) => void;
  isHidden?: () => boolean;
}

const TICK_MS = 100;

export function startAutoCapture(deps: AutoCaptureDeps): () => void {
  const now = deps.now ?? (() => performance.now());
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const cancel = deps.cancel ?? ((id) => clearTimeout(id));
  const isHidden = deps.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
  const tracker = new StabilityTracker();
  let stopped = false;
  let inFlight = false;
  let timer: number | null = null;

  const tick = () => {
    if (stopped) return;
    timer = schedule(tick, TICK_MS);
    if (isHidden()) {
      tracker.reset();
      return;
    }
    if (inFlight) return;
    const frame = deps.sample();
    if (!frame) return;
    const { img, scale } = frame;
    const diag = Math.hypot(img.width, img.height) / scale;
    inFlight = true;
    deps
      .detect(img)
      .catch(() => null)
      .then((q) => {
        inFlight = false;
        if (stopped) return;
        const full = q ? scaleQuad(q, 1 / scale) : null;
        const { smoothed, fire } = tracker.update(full, diag, now());
        deps.onQuad(smoothed);
        if (fire) {
          if (deps.enabled()) deps.onFire();
          else tracker.reset();
        }
      });
  };

  timer = schedule(tick, TICK_MS);
  return () => {
    stopped = true;
    if (timer !== null) cancel(timer);
    timer = null;
  };
}
