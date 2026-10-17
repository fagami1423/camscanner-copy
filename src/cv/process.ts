import type { FilterMode, Quad } from '../types';
import type { CV } from './types';
import { outputSize } from './geometry';
import { makeImageData } from './imageData';

const odd = (n: number) => {
  const r = Math.max(3, Math.round(n));
  return r % 2 === 1 ? r : r + 1;
};

/** Copy an 8-bit RGBA Mat out of the WASM heap into an ImageData. */
function toImageData(rgba: CV): ImageData {
  return makeImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
}

/**
 * Perspective-warp the quad region of `img` to a rectangle per spec §3 Warp:
 * size from `outputSize` (long side capped at 3000), INTER_CUBIC.
 */
export function warp(cv: CV, img: ImageData, q: Quad): ImageData {
  const { width, height } = outputSize(q);
  const src = cv.matFromImageData(img);
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap((p) => [p.x, p.y]));
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const dst = new cv.Mat();
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(width, height), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    return toImageData(dst);
  } finally {
    for (const m of [src, srcPts, dstPts, M, dst]) m.delete();
  }
}

/**
 * Background normalisation of one 8-bit channel, in place:
 * background = close(kernel ≈ long/30) then median blur; out = src / background · 255.
 */
function normalizeBackground(cv: CV, ch: CV, longSide: number): void {
  const k = Math.max(3, Math.round(longSide / 30));
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
  const bg = new cv.Mat();
  try {
    cv.morphologyEx(ch, bg, cv.MORPH_CLOSE, kernel);
    cv.medianBlur(bg, bg, odd(k / 4));
    cv.divide(ch, bg, ch, 255);
  } finally {
    kernel.delete();
    bg.delete();
  }
}

/** 1st and 99th percentile of an 8-bit single-channel Mat. */
function percentiles(mat: CV): [number, number] {
  const data: Uint8Array = mat.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const at = (frac: number) => {
    const target = frac * data.length;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  return [at(0.01), at(0.99)];
}

/** Linear stretch of `target` (in place) mapping [lo, hi] of `ref` to [0, 255]. */
function contrastStretch(ref: CV, target: CV): void {
  const [lo, hi] = percentiles(ref);
  if (hi - lo < 1) return;
  const a = 255 / (hi - lo);
  target.convertTo(target, -1, a, -lo * a);
}

function magic(cv: CV, src: CV, longSide: number): CV {
  const rgb = new cv.Mat();
  const planes = new cv.MatVector();
  const luma = new cv.Mat();
  const hsv = new cv.Mat();
  const hsvPlanes = new cv.MatVector();
  const out = new cv.Mat();
  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    cv.split(rgb, planes);
    for (let i = 0; i < 3; i++) {
      const ch = planes.get(i);
      try {
        normalizeBackground(cv, ch, longSide);
      } finally {
        ch.delete();
      }
    }
    cv.merge(planes, rgb);
    // Same stretch for every channel, derived from luminance, to avoid a colour cast.
    cv.cvtColor(rgb, luma, cv.COLOR_RGB2GRAY);
    contrastStretch(luma, rgb);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.split(hsv, hsvPlanes);
    const s = hsvPlanes.get(1);
    try {
      s.convertTo(s, -1, 1.15, 0); // saturating cast clamps to 255
    } finally {
      s.delete();
    }
    cv.merge(hsvPlanes, hsv);
    cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB);
    cv.cvtColor(rgb, out, cv.COLOR_RGB2RGBA);
    return out;
  } catch (e) {
    out.delete();
    throw e;
  } finally {
    for (const m of [rgb, planes, luma, hsv, hsvPlanes]) m.delete();
  }
}

function grayOrBw(cv: CV, src: CV, longSide: number, bw: boolean): CV {
  const gray = new cv.Mat();
  const out = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    normalizeBackground(cv, gray, longSide);
    if (bw) {
      cv.adaptiveThreshold(gray, gray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, odd(longSide / 40), 10);
    } else {
      contrastStretch(gray, gray);
    }
    cv.cvtColor(gray, out, cv.COLOR_GRAY2RGBA);
    return out;
  } catch (e) {
    out.delete();
    throw e;
  } finally {
    gray.delete();
  }
}

/** Apply an enhancement filter per spec §3 Enhance filters. Returns a new ImageData. */
export function enhance(cv: CV, img: ImageData, mode: FilterMode): ImageData {
  if (mode === 'original') return makeImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const longSide = Math.max(img.width, img.height);
  const src = cv.matFromImageData(img);
  let out: CV = null;
  try {
    out = mode === 'magic' ? magic(cv, src, longSide) : grayOrBw(cv, src, longSide, mode === 'bw');
    return toImageData(out);
  } finally {
    src.delete();
    out?.delete();
  }
}
