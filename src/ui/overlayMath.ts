import type { Point, Quad } from '../types';

export interface ContainTransform { scale: number; ox: number; oy: number }

/** Maps intrinsic video pixels to element pixels for `object-fit: contain` (centred letterbox). */
export function containTransform(vw: number, vh: number, cw: number, ch: number): ContainTransform {
  if (!(vw > 0) || !(vh > 0)) return { scale: 0, ox: 0, oy: 0 };
  const scale = Math.min(cw / vw, ch / vh);
  return { scale, ox: (cw - vw * scale) / 2, oy: (ch - vh * scale) / 2 };
}

export function quadToDisplay(q: Quad, t: ContainTransform): Point[] {
  return q.map((p) => ({ x: t.ox + p.x * t.scale, y: t.oy + p.y * t.scale }));
}
