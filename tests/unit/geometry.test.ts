import { describe, it, expect } from 'vitest';
import {
  orderCorners, outputSize, scaleQuad, fullFrameQuad, clampQuad, isValidQuad, StabilityTracker, liveQuadForStill,
} from '../../src/cv/geometry';
import type { Quad } from '../../src/types';

const q = (...p: number[][]): Quad => p.map(([x, y]) => ({ x, y })) as Quad;

describe('orderCorners', () => {
  it('orders shuffled points TL,TR,BR,BL', () => {
    const r = orderCorners([{ x: 100, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 100 }, { x: 100, y: 100 }]);
    expect(r).toEqual(q([10, 10], [100, 10], [100, 100], [10, 100]));
  });
});

describe('outputSize', () => {
  it('uses max opposite edges', () => {
    // top 200, bottom 220, left 300, right 310
    expect(outputSize(q([0, 0], [200, 0], [200, 310], [-20, 300]))).toEqual({ width: 220, height: 310 });
  });
  it('scales down to maxSide', () => {
    expect(outputSize(q([0, 0], [6000, 0], [6000, 8000], [0, 8000]))).toEqual({ width: 2250, height: 3000 });
  });
});

describe('scale/fullFrame/clamp', () => {
  it('scaleQuad', () => {
    expect(scaleQuad(fullFrameQuad(10, 20), 2)).toEqual(q([0, 0], [20, 0], [20, 40], [0, 40]));
  });
  it('clampQuad', () => {
    const r = clampQuad(q([-5, 2000], [1, 1], [2, 2], [3, 3]), 1000, 1000);
    expect(r[0]).toEqual({ x: 0, y: 1000 });
  });
});

describe('isValidQuad', () => {
  it('full frame valid', () => expect(isValidQuad(fullFrameQuad(100, 100), 100, 100)).toBe(true));
  it('small area invalid', () => {
    expect(isValidQuad(q([0, 0], [31.6, 0], [31.6, 31.6], [0, 31.6]), 100, 100)).toBe(false);
  });
  it('bow-tie invalid', () => {
    expect(isValidQuad(q([0, 0], [100, 100], [100, 0], [0, 100]), 100, 100)).toBe(false);
  });
  it('30 degree corner invalid', () => {
    expect(isValidQuad(q([0, 0], [100, 0], [186.6, 50], [86.6, 50]), 200, 100)).toBe(false);
  });
  it('concave invalid', () => {
    expect(isValidQuad(q([0, 0], [100, 0], [50, 20], [0, 100]), 100, 100)).toBe(false);
  });
});

describe('StabilityTracker', () => {
  const quad = fullFrameQuad(1000, 1000);
  const diag = 1414;
  it('fires at 800, then stays disarmed on the same steady quad', () => {
    const t = new StabilityTracker();
    for (let now = 0; now <= 700; now += 100) expect(t.update(quad, diag, now).fire).toBe(false);
    expect(t.update(quad, diag, 800).fire).toBe(true);
    for (let now = 900; now <= 2300; now += 100) {
      expect(t.update(quad, diag, now).fire, `t=${now}`).toBe(false);
    }
  });
  it('steady quad held 5 s fires exactly once', () => {
    const t = new StabilityTracker();
    let fires = 0;
    for (let now = 0; now <= 5000; now += 100) if (t.update(quad, diag, now).fire) fires++;
    expect(fires).toBe(1);
  });
  it('after the quad is lost (null), the same quad fires again after a fresh hold', () => {
    const t = new StabilityTracker();
    const fired: number[] = [];
    for (let now = 0; now <= 1900; now += 100) if (t.update(quad, diag, now).fire) fired.push(now);
    expect(t.update(null, diag, 2000).fire).toBe(false);
    for (let now = 2100; now <= 4000; now += 100) if (t.update(quad, diag, now).fire) fired.push(now);
    expect(fired).toEqual([800, 2900]);
  });
  it('after a move >= threshold then steady, fires again once the cooldown has passed', () => {
    const t = new StabilityTracker();
    const moved = quad.map((p) => ({ x: p.x + 0.03 * diag, y: p.y })) as Quad;
    const fired: number[] = [];
    for (let now = 0; now <= 800; now += 100) if (t.update(quad, diag, now).fire) fired.push(now);
    // hold restarts at 900 (done by 1700) but the 1.5 s cooldown from 800 holds it until 2300
    for (let now = 900; now <= 5000; now += 100) if (t.update(moved, diag, now).fire) fired.push(now);
    expect(fired).toEqual([800, 2300]);
  });
  it('small movement below threshold after a fire does not re-arm', () => {
    const t = new StabilityTracker();
    const nudged = quad.map((p) => ({ x: p.x + 0.01 * diag, y: p.y })) as Quad;
    let fires = 0;
    for (let now = 0; now <= 800; now += 100) if (t.update(quad, diag, now).fire) fires++;
    for (let now = 900; now <= 4000; now += 100) if (t.update(nudged, diag, now).fire) fires++;
    expect(fires).toBe(1);
  });
  it('jitter resets hold', () => {
    const t = new StabilityTracker();
    let firstFire = -1;
    for (let now = 0; now <= 2000; now += 100) {
      let input = quad;
      if (now === 400) input = quad.map((p) => ({ x: p.x + 0.03 * diag, y: p.y })) as Quad;
      if (t.update(input, diag, now).fire && firstFire < 0) firstFire = now;
    }
    expect(firstFire).toBeGreaterThanOrEqual(1200);
  });
  it('null resets', () => {
    const t = new StabilityTracker();
    t.update(quad, diag, 0);
    expect(t.update(null, diag, 100)).toEqual({ smoothed: null, fire: false });
    expect(t.update(quad, diag, 200).fire).toBe(false);
    expect(t.update(quad, diag, 900).fire).toBe(false);
    expect(t.update(quad, diag, 1000).fire).toBe(true);
  });
});

describe('liveQuadForStill', () => {
  const live: Quad = [{ x: 100, y: 50 }, { x: 1800, y: 60 }, { x: 1790, y: 1000 }, { x: 110, y: 1020 }];
  it('scales the live quad (video coords) by stillW / videoW when aspects match', () => {
    expect(liveQuadForStill(live, 1920, 1080, 3840, 2160)).toEqual(scaleQuad(live, 2));
  });
  it('accepts an aspect difference up to 2%', () => {
    // 16:9 video, still 1.5% wider in aspect
    const stillH = Math.round(4000 / ((1920 / 1080) * 1.015));
    expect(liveQuadForStill(live, 1920, 1080, 4000, stillH)).toEqual(scaleQuad(live, 4000 / 1920));
  });
  it('omits the hint when aspects differ by more than 2% (e.g. 4:3 photo from a 16:9 stream, or rotated)', () => {
    expect(liveQuadForStill(live, 1920, 1080, 4032, 3024)).toBeUndefined();
    expect(liveQuadForStill(live, 1920, 1080, 2160, 3840)).toBeUndefined();
  });
  it('omits the hint for degenerate sizes', () => {
    expect(liveQuadForStill(live, 0, 0, 4000, 3000)).toBeUndefined();
  });
});

