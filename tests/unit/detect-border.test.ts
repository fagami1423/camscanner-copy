import { describe, expect, it } from 'vitest';
import type { Quad } from '../../src/types';
import { isFrameArtifact } from '../../src/cv/detect';

const q = (pts: [number, number][]): Quad => pts.map(([x, y]) => ({ x, y })) as Quad;
// 360x480 frame: 1% tolerance is 3.6 px in x and 4.8 px in y.
const W = 360, H = 480;

describe('isFrameArtifact (quad ≈ whole frame)', () => {
  it('rejects a quad whose corners each sit on their own frame corner', () => {
    expect(isFrameArtifact(q([[0, 0], [W, 0], [W, H], [0, H]]), W, H)).toBe(true);
    expect(isFrameArtifact(q([[0, 0], [359, 0], [359, 479], [0, 479]]), W, H)).toBe(true);
    expect(isFrameArtifact(q([[3, 4], [357, 2], [358, 476], [1, 477]]), W, H)).toBe(true);
  });

  it('keeps a real page spanning the full frame width (close-up framing)', () => {
    expect(isFrameArtifact(q([[0, 100], [W, 100], [W, 400], [0, 400]]), W, H)).toBe(false);
    expect(isFrameArtifact(q([[0, 0], [W, 0], [W, 300], [0, 300]]), W, H)).toBe(false);
  });

  it('keeps a quad with only three corners at frame corners', () => {
    expect(isFrameArtifact(q([[0, 0], [W, 0], [W, H], [40, 440]]), W, H)).toBe(false);
    expect(isFrameArtifact(q([[10, 10], [W, 0], [W, H], [0, H]]), W, H)).toBe(false);
  });

  it('keeps an ordinary page quad', () => {
    expect(isFrameArtifact(q([[56, 65], [307, 78], [318, 421], [41, 403]]), W, H)).toBe(false);
  });
});
