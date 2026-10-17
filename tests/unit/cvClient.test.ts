import { vi } from 'vitest';
import { describe, expect, it } from 'vitest';
import * as Comlink from 'comlink';
import { createCvClient, type CvApi, type CvState } from '../../src/cv/client';

/** A fake Worker backed by a MessageChannel; `serve` exposes an API on the far end. */
function fakeWorker(serve?: CvApi) {
  const { port1, port2 } = new MessageChannel();
  if (serve) Comlink.expose(serve, port2 as unknown as Comlink.Endpoint);
  const w = port1 as unknown as Worker & { fire(msg: string): void };
  w.fire = (message: string) => (w.onerror as (e: unknown) => void)({ message });
  return { w, close: () => { port1.close(); port2.close(); } };
}

const okApi: CvApi = {
  ready: async () => {},
  detect: async () => null,
  warp: async (img) => img,
  enhance: async (img) => img,
};

describe('createCvClient', () => {
  it('goes loading -> ready on success', async () => {
    const fw = fakeWorker(okApi);
    const c = createCvClient(() => fw.w);
    const seen: CvState[] = [];
    c.onCvProgress((s) => seen.push(s));
    await c.getCv().ready();
    expect(seen).toEqual(['loading', 'ready']);
    const late: CvState[] = [];
    c.onCvProgress((s) => late.push(s));
    expect(late).toEqual(['ready']);
    fw.close();
  });

  it('worker error event -> state error and ready() rejects (not hang)', async () => {
    const fw = fakeWorker(); // nobody serves: ready() would hang forever
    const c = createCvClient(() => fw.w);
    const seen: [CvState, string | undefined][] = [];
    c.onCvProgress((s, e) => seen.push([s, e]));
    const p = c.getCv().ready();
    fw.w.fire('boom');
    await expect(p).rejects.toThrow(/boom/);
    expect(seen.map((x) => x[0])).toEqual(['loading', 'error']);
    expect(seen[1][1]).toMatch(/boom/);
    await expect(c.getCv().detect({} as ImageData)).rejects.toThrow(/boom/);
    fw.close();
  });

  it('init failure reported by the worker -> error state, ready() rejects', async () => {
    const fw = fakeWorker({ ...okApi, ready: async () => { throw new Error('OpenCV aborted: wasm'); } });
    const c = createCvClient(() => fw.w);
    await expect(c.getCv().ready()).rejects.toThrow(/aborted/);
    const late: [CvState, string | undefined][] = [];
    c.onCvProgress((s, e) => late.push([s, e]));
    expect(late[0][0]).toBe('error');
    fw.close();
  });

  it('not ready within 60 s -> error "Scanner engine timed out", ready() rejects', async () => {
    vi.useFakeTimers();
    try {
      const fw = fakeWorker(); // never answers
      const c = createCvClient(() => fw.w);
      const seen: [CvState, string | undefined][] = [];
      c.onCvProgress((s, e) => seen.push([s, e]));
      const p = c.getCv().ready();
      p.catch(() => {});
      await vi.advanceTimersByTimeAsync(59_999);
      expect(seen).toEqual([['loading', undefined]]);
      await vi.advanceTimersByTimeAsync(1);
      expect(seen).toEqual([['loading', undefined], ['error', 'Scanner engine timed out']]);
      await expect(p).rejects.toThrow('Scanner engine timed out');
      await expect(c.getCv().detect({} as ImageData)).rejects.toThrow('Scanner engine timed out');
      fw.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ready before the timeout: the timer never flips it to error', async () => {
    vi.useFakeTimers();
    try {
      const fw = fakeWorker(okApi);
      const c = createCvClient(() => fw.w);
      await vi.waitFor(() => c.getCv().ready());
      await vi.advanceTimersByTimeAsync(120_000);
      const late: CvState[] = [];
      c.onCvProgress((s) => late.push(s));
      expect(late).toEqual(['ready']);
      fw.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
