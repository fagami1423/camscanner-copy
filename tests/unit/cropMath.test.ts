import { describe, it, expect } from 'vitest';
import { imageToDisplay, displayToImage, moveHandle, loupeSourceRect, grabOffset, dragTarget, sameQuad } from '../../src/ui/cropMath';
import type { Quad } from '../../src/types';

const q: Quad = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }];

describe('cropMath', () => {
  it('maps between display and image coordinates', () => {
    const nat = { w: 1000, h: 500 };
    const shown = { w: 250, h: 125 };
    expect(imageToDisplay({ x: 400, y: 200 }, nat, shown)).toEqual({ x: 100, y: 50 });
    expect(displayToImage({ x: 100, y: 50 }, nat, shown)).toEqual({ x: 400, y: 200 });
  });
  it('moveHandle clamps to the image and moves only that corner', () => {
    const r = moveHandle(q, 2, { x: 5000, y: -20 }, 1000, 500);
    expect(r[2]).toEqual({ x: 1000, y: 0 });
    expect(r[0]).toEqual(q[0]);
  });
  it('loupeSourceRect is centred on the point at 2x zoom', () => {
    const r = loupeSourceRect({ x: 300, y: 200 }, 120, 2);
    expect(r).toEqual({ x: 270, y: 170, size: 60 });
  });
});

describe('grab offset (handle does not jump to the pointer)', () => {
  it('grabbing off-centre keeps the handle where it is', () => {
    const handle = { x: 100, y: 100 };
    const down = { x: 115, y: 92 }; // inside the r=24 hit circle, off the dot
    const off = grabOffset(handle, down);
    expect(off).toEqual({ x: -15, y: 8 });
    expect(dragTarget(down, off)).toEqual(handle);
  });
  it('the handle follows pointer movement by the same delta', () => {
    const off = grabOffset({ x: 100, y: 100 }, { x: 115, y: 92 });
    expect(dragTarget({ x: 125, y: 80 }, off)).toEqual({ x: 110, y: 88 });
  });
});

describe('sameQuad', () => {
  it('treats corners within 0.5 px as unchanged', () => {
    const moved = q.map((p) => ({ x: p.x + 0.5, y: p.y - 0.3 })) as Quad;
    expect(sameQuad(q, q)).toBe(true);
    expect(sameQuad(q, moved)).toBe(true);
  });
  it('detects a corner moved by more than 0.5 px', () => {
    const moved = q.map((p, i) => (i === 2 ? { x: p.x + 0.6, y: p.y } : p)) as Quad;
    expect(sameQuad(q, moved)).toBe(false);
  });
});

