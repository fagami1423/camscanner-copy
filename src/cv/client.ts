import * as Comlink from 'comlink';
import type { FilterMode, Quad } from '../types';

export interface CvApi {
  ready(): Promise<void>;
  detect(img: ImageData): Promise<Quad | null>;
  warp(img: ImageData, q: Quad): Promise<ImageData>;
  enhance(img: ImageData, mode: FilterMode): Promise<ImageData>;
}

export type CvState = 'loading' | 'ready' | 'error';
export type CvProgressCb = (state: CvState, error?: string) => void;

/**
 * Builds a CV client around a worker factory. Readiness is tracked client-side so that a worker
 * that dies (module evaluation error, onerror) or reports an init failure makes `ready()` and
 * every call reject instead of hanging.
 */
export const CV_TIMEOUT_MS = 60_000;
export const CV_TIMEOUT_MESSAGE = 'Scanner engine timed out';

export function createCvClient(makeWorker: () => Worker, opts: { timeoutMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? CV_TIMEOUT_MS;
  let remote: Comlink.Remote<CvApi> | null = null;
  let api: Comlink.Remote<CvApi> | null = null;
  let state: CvState = 'loading';
  let errorMsg: string | undefined;
  const listeners = new Set<CvProgressCb>();

  const setState = (s: CvState, err?: string) => {
    if (state !== 'loading') return; // first outcome wins
    state = s;
    errorMsg = err;
    listeners.forEach((cb) => cb(s, err));
  };

  function init(): Comlink.Remote<CvApi> {
    const worker = makeWorker();
    const r = Comlink.wrap<CvApi>(worker);
    remote = r;
    let fail!: (msg: string) => void;
    const failure = new Promise<never>((_, reject) => {
      fail = (msg) => {
        setState('error', msg);
        reject(new Error(msg));
      };
    });
    failure.catch(() => {}); // consumers observe it via ready()/calls/onCvProgress
    worker.onerror = (e) => fail(`CV worker error: ${e.message || 'failed to start'}`);
    worker.onmessageerror = () => fail('CV worker message error');
    // A worker that never answers (hung WASM init, stalled download) must not leave captures queued
    // forever: 'error' switches the capture queue to its unprocessed fallback.
    const timer = setTimeout(() => fail(CV_TIMEOUT_MESSAGE), timeoutMs);
    const readyP = Promise.race([r.ready(), failure]).finally(() => clearTimeout(timer)).then(
      () => setState('ready'),
      (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        fail(msg);
        throw new Error(msg);
      },
    );
    readyP.catch(() => {});
    const guard = <T,>(p: Promise<T>) => Promise.race([p, failure]);
    api = {
      ready: () => readyP,
      detect: (img: ImageData) => guard(r.detect(img)),
      warp: (img: ImageData, q: Quad) => guard(r.warp(img, q)),
      enhance: (img: ImageData, mode: FilterMode) => guard(r.enhance(img, mode)),
    } as unknown as Comlink.Remote<CvApi>;
    return api;
  }

  return {
    getCv(): Comlink.Remote<CvApi> {
      return remote ? api! : init();
    },
    /** Reports 'loading' until the CV runtime is ready, then 'ready' (or 'error'). Returns unsubscribe. */
    onCvProgress(cb: CvProgressCb): () => void {
      listeners.add(cb);
      cb(state, errorMsg);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

const defaultClient = createCvClient(
  () => new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' }),
);

/** Lazy singleton remote for the CV worker. */
export const getCv = defaultClient.getCv;
export const onCvProgress = defaultClient.onCvProgress;
