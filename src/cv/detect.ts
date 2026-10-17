import type { Point, Quad } from '../types';
import type { CV } from './types';
import { isValidQuad, orderCorners } from './geometry';

/** Kernel for the Otsu-fallback morphological close (spec leaves size open). */
const FALLBACK_CLOSE = 5;
/** Canny threshold pairs (× median gray), tried in order before the Otsu fallback. */
const CANNY_CASCADE: [number, number][] = [
  [0.66, 1.33],
  [0.33, 0.66],
];
/** Per-axis tolerance (fraction of that frame dimension) for matching a corner to a frame corner. */
const FRAME_CORNER_FRAC = 0.01;

/**
 * True when the (TL, TR, BR, BL) quad is essentially the whole frame: each corner lies within 1%
 * (of the respective dimension) of its own frame corner (0,0), (w,0), (w,h), (0,h). Such a
 * contour is the image boundary (e.g. Otsu splitting text from everything else), not a page.
 * A page that merely spans the full width or height is kept.
 */
export function isFrameArtifact(q: Quad, w: number, h: number): boolean {
  const frame = [[0, 0], [w, 0], [w, h], [0, h]];
  const tx = FRAME_CORNER_FRAC * w;
  const ty = FRAME_CORNER_FRAC * h;
  return q.every((p, i) => Math.abs(p.x - frame[i][0]) <= tx && Math.abs(p.y - frame[i][1]) <= ty);
}

function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Median of an 8-bit single-channel Mat. */
function median8u(mat: CV): number {
  const data: Uint8Array = mat.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const half = data.length / 2;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= half) return v;
  }
  return 255;
}

/**
 * External contours of a binary image -> approxPolyDP(0.02·perimeter) -> keep 4-vertex quads
 * passing `isValidQuad` and not hugging the frame border; return the largest (corner-ordered) or null.
 */
function largestQuad(cv: CV, binary: CV, w: number, h: number): Quad | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best: Quad | null = null;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const approx = new cv.Mat();
      try {
        cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
        if (approx.rows !== 4) continue;
        const pts: Point[] = [];
        for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] });
        const q = orderCorners(pts);
        if (!isValidQuad(q, w, h) || isFrameArtifact(q, w, h)) continue;
        const area = quadArea(q);
        if (area > bestArea) {
          best = q;
          bestArea = area;
        }
      } finally {
        approx.delete();
        c.delete();
      }
    }
    return best;
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * Detect the page quad (TL, TR, BR, BL) in `img` pixel coordinates, per spec §3 Live detection
 * steps 3–5: Canny(0.66/1.33·median) → Canny(0.33/0.66·median) → Otsu + close. Expects a downscaled frame (long side ~480 px). Returns null if no valid quad.
 */
export function detectQuad(cv: CV, img: ImageData): Quad | null {
  const { width: w, height: h } = img;
  const src = cv.matFromImageData(img);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const bin = new cv.Mat();
  const k3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const kClose = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(FALLBACK_CLOSE, FALLBACK_CLOSE));
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    const med = median8u(blurred);
    for (const [lo, hi] of CANNY_CASCADE) {
      cv.Canny(blurred, edges, lo * med, hi * med);
      cv.dilate(edges, edges, k3, new cv.Point(-1, -1), 1);
      const q = largestQuad(cv, edges, w, h);
      if (q) return q;
    }

    cv.threshold(blurred, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kClose);
    return largestQuad(cv, bin, w, h);
  } finally {
    for (const m of [src, gray, blurred, edges, bin, k3, kClose]) m.delete();
  }
}
