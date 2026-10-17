import { describe, it, expect, vi } from 'vitest';
import { createCaptureQueue, RAW_FALLBACK_MESSAGE } from '../../src/camera/captureQueue';

const blob = (s: string) => new Blob([s]);
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { failProcessedWhenError?: boolean } = {}) {
  const calls: string[] = [];
  let q: ReturnType<typeof createCaptureQueue>;
  const deps = {
    saveProcessed: vi.fn(async (b: Blob) => {
      const t = await b.text();
      if (opts.failProcessedWhenError) {
        q.setCvState('error'); // CV dies while this save is in flight
        throw new Error('CV worker error');
      }
      calls.push(`processed:${t}`);
    }),
    saveRaw: vi.fn(async (b: Blob) => {
      calls.push(`raw:${await b.text()}`);
    }),
    onSaved: vi.fn(),
    onPending: vi.fn(),
    onSaveError: vi.fn(),
    notify: vi.fn(),
  };
  q = createCaptureQueue(deps);
  return { q, deps, calls };
}

describe('captureQueue', () => {
  it('holds captures while CV is loading, then saves them processed in order once ready', async () => {
    const { q, deps, calls } = setup();
    q.push([blob('a'), blob('b')]);
    await flush();
    expect(deps.saveProcessed).not.toHaveBeenCalled();
    expect(deps.onPending).toHaveBeenLastCalledWith(2);
    q.setCvState('ready');
    await q.idle();
    expect(calls).toEqual(['processed:a', 'processed:b']);
    expect(deps.onSaved).toHaveBeenCalledTimes(2);
    expect(deps.onPending).toHaveBeenLastCalledWith(0);
  });

  it('on CV error: clears the counter, toasts once, saves each queued capture raw in order', async () => {
    const { q, deps, calls } = setup();
    q.push([blob('a'), blob('b'), blob('c')]);
    q.setCvState('error');
    expect(deps.onPending).toHaveBeenLastCalledWith(0);
    expect(deps.notify).toHaveBeenCalledOnce();
    expect(deps.notify).toHaveBeenCalledWith(RAW_FALLBACK_MESSAGE(3));
    expect(RAW_FALLBACK_MESSAGE(3)).toBe('3 captured page(s) could not be processed — scanner engine failed to load');
    await q.idle();
    expect(calls).toEqual(['raw:a', 'raw:b', 'raw:c']);
    expect(deps.saveProcessed).not.toHaveBeenCalled();
    expect(deps.onSaved).toHaveBeenCalledTimes(3);
    expect(deps.onPending).toHaveBeenLastCalledWith(0);
    expect(q.pending()).toBe(0);
  });

  it('does not toast on error when nothing is queued', () => {
    const { q, deps } = setup();
    q.setCvState('error');
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('keeps the in-flight capture when CV dies mid-save and saves it raw', async () => {
    const { q, deps, calls } = setup({ failProcessedWhenError: true });
    q.setCvState('ready');
    q.push([blob('a'), blob('b')]);
    await q.idle();
    expect(calls).toEqual(['raw:a', 'raw:b']);
    expect(deps.onSaveError).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(RAW_FALLBACK_MESSAGE(2));
  });

  it('reports a failed save and moves on to the next capture', async () => {
    const { q, deps, calls } = setup();
    deps.saveProcessed.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    q.setCvState('ready');
    q.push([blob('a'), blob('b')]);
    await q.idle();
    expect(deps.onSaveError).toHaveBeenCalledOnce();
    expect(calls).toEqual(['processed:b']);
    expect(q.pending()).toBe(0);
  });

  it('discard() drops captures not yet started, keeps the in-flight one, reports pending', async () => {
    const { q, deps, calls } = setup();
    q.push([blob('a'), blob('b'), blob('c')]);
    q.setCvState('ready'); // 'a' starts saving
    expect(q.discard()).toBe(2);
    expect(q.pending()).toBe(1);
    expect(deps.onPending).toHaveBeenLastCalledWith(1);
    await q.idle();
    expect(calls).toEqual(['processed:a']);
    expect(q.pending()).toBe(0);
  });

  it('discard() while CV is loading drops everything', async () => {
    const { q, deps } = setup();
    q.push([blob('a'), blob('b')]);
    expect(q.discard()).toBe(2);
    expect(q.pending()).toBe(0);
    q.setCvState('ready');
    await q.idle();
    expect(deps.saveProcessed).not.toHaveBeenCalled();
  });

  it('carries per-item data (e.g. the live-quad hint) through to the save callbacks', async () => {
    type Item = { blob: Blob; hint?: string };
    const seen: Array<string | undefined> = [];
    const q = createCaptureQueue<Item>({
      saveProcessed: async (it) => void seen.push(it.hint),
      saveRaw: async () => {},
      onSaved: () => {}, onPending: () => {}, onSaveError: () => {}, notify: () => {},
    });
    q.push([{ blob: blob('a'), hint: 'live-a' }, { blob: blob('b') }]);
    q.setCvState('ready');
    await q.idle();
    expect(seen).toEqual(['live-a', undefined]);
  });
});

