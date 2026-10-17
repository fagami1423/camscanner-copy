import { describe, it, expect, vi } from 'vitest';
import { startAutoCapture } from '../../src/camera/autocapture';
import type { Quad } from '../../src/types';

const Q: Quad = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 70 }, { x: 10, y: 70 }];
const img = { width: 100, height: 80 } as ImageData;

function harness(over: Record<string, unknown> = {}) {
  let t = 0;
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const schedule = (fn: () => void) => { const id = nextId++; pending.set(id, fn); return id; };
  const cancel = (id: number) => { pending.delete(id); };
  const deps = {
    sample: vi.fn(() => ({ img, scale: 0.5 })),
    detect: vi.fn(async () => Q),
    onQuad: vi.fn(),
    onFire: vi.fn(),
    enabled: () => true,
    now: () => t,
    schedule,
    cancel,
    isHidden: () => false,
    ...over,
  };
  const stop = startAutoCapture(deps as never);
  const tick = async () => {
    const fns = [...pending.values()];
    pending.clear();
    fns.forEach((f) => f());
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    t += 100;
  };
  return { deps, stop, tick, pending };
}

describe('startAutoCapture', () => {
  it('fires once for a steady quad after >= 800 ms', async () => {
    const h = harness();
    for (let i = 0; i < 12; i++) await h.tick();
    expect(h.deps.onFire).toHaveBeenCalledTimes(1);
  });

  it('skips ticks while detect is in flight', async () => {
    const h = harness({ detect: vi.fn(() => new Promise(() => {})) });
    for (let i = 0; i < 5; i++) await h.tick();
    expect(h.deps.detect).toHaveBeenCalledTimes(1);
    expect(h.deps.sample).toHaveBeenCalledTimes(1);
  });

  it('enabled() false: onQuad still called, never fires, needs fresh hold after enabling', async () => {
    let en = false;
    const h = harness({ enabled: () => en });
    for (let i = 0; i < 15; i++) await h.tick();
    expect(h.deps.onQuad).toHaveBeenCalled();
    expect(h.deps.onFire).not.toHaveBeenCalled();
    en = true;
    await h.tick();
    expect(h.deps.onFire).not.toHaveBeenCalled();
    for (let i = 0; i < 12; i++) await h.tick();
    expect(h.deps.onFire).toHaveBeenCalledTimes(1);
  });

  it('stop cancels ticks and ignores in-flight result', async () => {
    let resolve!: (q: Quad) => void;
    const h = harness({ detect: vi.fn(() => new Promise<Quad>((r) => { resolve = r; })) });
    await h.tick();
    h.stop();
    expect(h.pending.size).toBe(0);
    resolve(Q);
    await Promise.resolve(); await Promise.resolve();
    expect(h.deps.onQuad).not.toHaveBeenCalled();
  });

  it('scales the quad to full-res before onQuad', async () => {
    const h = harness();
    await h.tick();
    const q = h.deps.onQuad.mock.calls[0][0] as Quad;
    expect(q[0]).toEqual({ x: 20, y: 20 });
    expect(q[2]).toEqual({ x: 180, y: 140 });
  });

  it('rejected detect counts as null and loop continues', async () => {
    const detect = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(Q);
    const h = harness({ detect });
    await h.tick();
    expect(h.deps.onQuad).toHaveBeenLastCalledWith(null);
    await h.tick();
    expect(detect).toHaveBeenCalledTimes(2);
    expect(h.deps.onQuad).toHaveBeenCalledTimes(2);
  });

  it('pauses while hidden and resumes when visible', async () => {
    let hidden = true;
    const h = harness({ isHidden: () => hidden });
    for (let i = 0; i < 3; i++) await h.tick();
    expect(h.deps.sample).not.toHaveBeenCalled();
    hidden = false;
    await h.tick();
    expect(h.deps.sample).toHaveBeenCalledTimes(1);
  });
});
