import { clampQuad } from '../cv/geometry';
import type { Point, Quad } from '../types';

export interface Size {
  w: number;
  h: number;
}

export function imageToDisplay(p: Point, natural: Size, shown: Size): Point {
  return { x: (p.x * shown.w) / natural.w, y: (p.y * shown.h) / natural.h };
}

export function displayToImage(p: Point, natural: Size, shown: Size): Point {
  return { x: (p.x * natural.w) / shown.w, y: (p.y * natural.h) / shown.h };
}

/** Moves corner `index` to `to` (image coords), clamped to the frame. */
export function moveHandle(q: Quad, index: number, to: Point, w: number, h: number): Quad {
  const next = q.map((p, i) => (i === index ? to : p)) as Quad;
  return clampQuad(next, w, h);
}

/** Square region (display coords) that the loupe magnifies, centred on `center`. */
export function loupeSourceRect(center: Point, loupeSize: number, zoom: number) {
  const size = loupeSize / zoom;
  return { x: center.x - size / 2, y: center.y - size / 2, size };
}

/** Pointer-to-handle offset captured at pointerdown (display coords), so a grab off-centre does not snap. */
export function grabOffset(handle: Point, pointer: Point): Point {
  return { x: handle.x - pointer.x, y: handle.y - pointer.y };
}

/** Where the dragged handle goes for the current pointer position. */
export function dragTarget(pointer: Point, offset: Point): Point {
  return { x: pointer.x + offset.x, y: pointer.y + offset.y };
}

/** Quads equal within `tol` px on every coordinate (e.g. crop Apply with nothing moved). */
export function sameQuad(a: Quad, b: Quad, tol = 0.5): boolean {
  return a.every((p, i) => Math.abs(p.x - b[i].x) <= tol && Math.abs(p.y - b[i].y) <= tol);
}
