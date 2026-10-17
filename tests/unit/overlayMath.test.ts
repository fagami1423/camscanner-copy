import { describe, it, expect } from 'vitest';
import { containTransform, quadToDisplay } from '../../src/ui/overlayMath';

describe('containTransform', () => {
  it('letterboxes a wide video in a tall box (bars top/bottom)', () => {
    const t = containTransform(1920, 1080, 400, 800);
    expect(t.scale).toBeCloseTo(400 / 1920);
    expect(t.ox).toBeCloseTo(0);
    expect(t.oy).toBeCloseTo((800 - 1080 * (400 / 1920)) / 2);
  });
  it('pillarboxes a tall video in a wide box (bars left/right)', () => {
    const t = containTransform(1080, 1920, 1000, 500);
    expect(t.scale).toBeCloseTo(500 / 1920);
    expect(t.oy).toBeCloseTo(0);
    expect(t.ox).toBeCloseTo((1000 - 1080 * (500 / 1920)) / 2);
  });
  it('returns a zero scale for an unknown video size', () => {
    expect(containTransform(0, 0, 100, 100).scale).toBe(0);
  });
});

describe('quadToDisplay', () => {
  it('maps video-pixel corners into element coordinates', () => {
    const t = containTransform(200, 100, 100, 100); // scale .5, oy 25
    const out = quadToDisplay([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }], t);
    expect(out).toEqual([{ x: 0, y: 25 }, { x: 100, y: 25 }, { x: 100, y: 75 }, { x: 0, y: 75 }]);
  });
});
