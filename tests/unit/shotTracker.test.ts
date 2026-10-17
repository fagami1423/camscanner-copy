import { describe, expect, it } from 'vitest';
import { createShotTracker } from '../../src/camera/shotTracker';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createShotTracker', () => {
  it('is idle with no shot in flight', async () => {
    const t = createShotTracker();
    expect(t.busy()).toBe(false);
    await expect(t.idle()).resolves.toBeUndefined();
  });

  it('refuses a second shot while one is in flight', async () => {
    const t = createShotTracker();
    const d = deferred();
    expect(t.run(() => d.promise)).toBe(true);
    expect(t.busy()).toBe(true);
    expect(t.run(() => Promise.resolve())).toBe(false);
    d.resolve();
    await t.idle();
    expect(t.busy()).toBe(false);
  });

  it('idle() waits for the in-flight shot to finish', async () => {
    const t = createShotTracker();
    const d = deferred();
    const order: string[] = [];
    t.run(async () => {
      await d.promise;
      order.push('shot');
    });
    const idle = t.idle().then(() => order.push('idle'));
    await Promise.resolve();
    expect(order).toEqual([]);
    d.resolve();
    await idle;
    expect(order).toEqual(['shot', 'idle']);
  });

  it('idle() resolves (never rejects) when the shot fails', async () => {
    const t = createShotTracker();
    const d = deferred();
    t.run(() => d.promise);
    d.reject(new Error('camera gone'));
    await expect(t.idle()).resolves.toBeUndefined();
    expect(t.busy()).toBe(false);
  });

  it('calls onSettled after each shot finishes', async () => {
    let settled = 0;
    const t = createShotTracker(() => settled++);
    t.run(() => Promise.reject(new Error('x')));
    await t.idle();
    t.run(() => Promise.resolve());
    await t.idle();
    expect(settled).toBe(2);
  });
});
