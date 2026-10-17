import type { Point, Quad } from '../types';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function orderCorners(pts: Point[]): Quad {
  const by = (f: (p: Point) => number, sign: 1 | -1) =>
    pts.reduce((best, p) => (sign * f(p) < sign * f(best) ? p : best));
  const tl = by((p) => p.x + p.y, 1);
  const br = by((p) => p.x + p.y, -1);
  const tr = by((p) => p.y - p.x, 1);
  const bl = by((p) => p.y - p.x, -1);
  return [{ ...tl }, { ...tr }, { ...br }, { ...bl }];
}

export function outputSize(q: Quad, maxSide = 3000): { width: number; height: number } {
  let width = Math.max(dist(q[1], q[0]), dist(q[2], q[3]));
  let height = Math.max(dist(q[3], q[0]), dist(q[2], q[1]));
  const m = Math.max(width, height);
  if (m > maxSide) {
    const k = maxSide / m;
    width *= k;
    height *= k;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

export function scaleQuad(q: Quad, s: number): Quad {
  return q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad;
}

/**
 * Maps a live-preview quad (full-res video coords) onto a still of `stillW`x`stillH` by
 * stillW / videoW. Returns undefined when the aspect ratios differ by more than `tol` (the still is
 * then a different crop or orientation of the scene, and the scaled quad would be wrong).
 */
export function liveQuadForStill(
  q: Quad,
  videoW: number,
  videoH: number,
  stillW: number,
  stillH: number,
  tol = 0.02,
): Quad | undefined {
  if (!(videoW > 0 && videoH > 0 && stillW > 0 && stillH > 0)) return undefined;
  const va = videoW / videoH;
  if (Math.abs(stillW / stillH - va) / va > tol) return undefined;
  return scaleQuad(q, stillW / videoW);
}

export function fullFrameQuad(w: number, h: number): Quad {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

export function clampQuad(q: Quad, w: number, h: number): Quad {
  return q.map((p) => ({
    x: Math.min(w, Math.max(0, p.x)),
    y: Math.min(h, Math.max(0, p.y)),
  })) as Quad;
}

export function isValidQuad(q: Quad, frameW: number, frameH: number, minAreaFrac = 0.2): boolean {
  // convexity: all consecutive-edge cross products share a sign
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cr > 0) pos++;
    else if (cr < 0) neg++;
    else return false;
  }
  if (pos !== 4 && neg !== 4) return false;

  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area) / 2;
  if (area < minAreaFrac * frameW * frameH) return false;

  const eps = 1e-9;
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4], c = q[i], n = q[(i + 1) % 4];
    const v1 = { x: p.x - c.x, y: p.y - c.y };
    const v2 = { x: n.x - c.x, y: n.y - c.y };
    const l = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    if (l === 0) return false;
    const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / l));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    if (deg < 45 - eps || deg > 135 + eps) return false;
  }
  return true;
}

function maxDisplacement(a: Quad, b: Quad): number {
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, dist(a[i], b[i]));
  return m;
}

export class StabilityTracker {
  private alpha: number;
  private thresholdFrac: number;
  private holdMs: number;
  private cooldownMs: number;
  private smoothed: Quad | null = null;
  private prevRaw: Quad | null = null;
  private holdStart: number | null = null;
  private lastFire: number | null = null;
  /** Raw quad at the last fire; while set, the tracker is disarmed (one capture per presented page). */
  private firedAt: Quad | null = null;

  constructor(opts: { alpha?: number; thresholdFrac?: number; holdMs?: number; cooldownMs?: number } = {}) {
    this.alpha = opts.alpha ?? 0.5;
    this.thresholdFrac = opts.thresholdFrac ?? 0.02;
    this.holdMs = opts.holdMs ?? 800;
    this.cooldownMs = opts.cooldownMs ?? 1500;
  }

  update(q: Quad | null, diag: number, now: number): { smoothed: Quad | null; fire: boolean } {
    if (!q) {
      this.smoothed = null;
      this.prevRaw = null;
      this.holdStart = null;
      this.firedAt = null; // page lost: re-arm
      return { smoothed: null, fire: false };
    }
    const a = this.alpha;
    const prevS = this.smoothed;
    this.smoothed = prevS
      ? (q.map((p, i) => ({
          x: a * p.x + (1 - a) * prevS[i].x,
          y: a * p.y + (1 - a) * prevS[i].y,
        })) as Quad)
      : q.map((p) => ({ ...p })) as Quad;

    if (!this.prevRaw || this.holdStart === null) {
      this.holdStart = now;
    } else if (maxDisplacement(q, this.prevRaw) / diag >= this.thresholdFrac) {
      this.holdStart = now;
    }
    this.prevRaw = q.map((p) => ({ ...p })) as Quad;

    // Disarmed after a fire until the quad moves >= threshold from where it fired; the hold restarts then.
    if (this.firedAt && maxDisplacement(q, this.firedAt) / diag >= this.thresholdFrac) {
      this.firedAt = null;
      this.holdStart = now;
    }

    let fire = false;
    if (
      !this.firedAt &&
      now - this.holdStart >= this.holdMs &&
      (this.lastFire === null || now - this.lastFire >= this.cooldownMs)
    ) {
      fire = true;
      this.lastFire = now;
      this.holdStart = now;
      this.firedAt = q.map((p) => ({ ...p })) as Quad;
    }
    return { smoothed: this.smoothed, fire };
  }

  reset(): void {
    this.smoothed = null;
    this.prevRaw = null;
    this.holdStart = null;
    this.lastFire = null;
    this.firedAt = null;
  }
}
