import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FilterMode, Quad } from '../../src/types';
import type { CV } from '../../src/cv/types';
import { fullFrameQuad, outputSize } from '../../src/cv/geometry';
import { enhance, warp } from '../../src/cv/process';
import { imageData, loadCv, readPng, trackMats } from './loadCv';

const FIX = join(__dirname, '..', 'fixtures', 'generated');
const truth: { file: string; quad: Quad | null }[] = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'truth.json'), 'utf8'));

let cv: CV;
beforeAll(async () => {
  cv = await loadCv();
});

function solid(w: number, h: number, v: number): ImageData {
  const d = new Uint8ClampedArray(w * h * 4).fill(v);
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return imageData(d, w, h);
}

/** Mean, std-dev and 90th percentile of the luma over a rectangle. */
function regionStats(img: ImageData, x0: number, y0: number, x1: number, y1: number) {
  let sum = 0, sq = 0, n = 0;
  const hist = new Uint32Array(256);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const v = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      sum += v; sq += v * v; n++;
      hist[Math.round(v)]++;
    }
  }
  let acc = 0, p90 = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= 0.9 * n) { p90 = v; break; }
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), p90 };
}

/** White page with a left->right lighting gradient (120 -> 240) and a band of black text bars. */
function gradientPage(w = 800, h = 600): ImageData {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const light = 120 + (120 * x) / (w - 1);
      const ink = y >= 60 && y < 200 && (y % 40) < 14 && (x % 90) < 70 && x > 40 && x < w - 40;
      const v = ink ? light * 0.1 : light;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return imageData(d, w, h);
}

describe('warp', () => {
  it('dark-desk with its truth quad: outputSize dims and a white page', () => {
    const t = truth.find((e) => e.file === 'dark-desk.png')!;
    const src = readPng(join(FIX, t.file));
    const out = warp(cv, src, t.quad!);
    const size = outputSize(t.quad!);
    expect(out.width).toBe(size.width);
    expect(out.height).toBe(size.height);
    expect(out.data.length).toBe(size.width * size.height * 4);
    const { width: w, height: h } = out;
    // Paper, not background: the centre 50% region's bright pixels are page-white
    // (90th percentile, so the text ink doesn't count against it)...
    const centre = regionStats(out, Math.round(w * 0.25), Math.round(h * 0.25), Math.round(w * 0.75), Math.round(h * 0.75));
    expect(centre.p90).toBeGreaterThan(200);
    // ...while the same statistic on the source's background corner (outside the quad) is dark.
    const bgCorner = regionStats(src, 0, 0, 150, 200);
    expect(bgCorner.p90).toBeLessThan(100);
  });

  it('caps the long side at 3000', () => {
    const img = solid(4000, 6000, 255);
    const out = warp(cv, img, fullFrameQuad(4000, 6000));
    expect(Math.max(out.width, out.height)).toBe(3000);
    expect(out.width).toBe(2000);
  });
});

describe('enhance', () => {
  it("'original' returns identical pixels", () => {
    const img = gradientPage();
    const out = enhance(cv, img, 'original');
    expect(out.width).toBe(img.width);
    expect(out.height).toBe(img.height);
    expect(Buffer.from(out.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it("'bw' output is only 0 or 255", () => {
    const t = truth.find((e) => e.file === 'dark-desk.png')!;
    const page = warp(cv, readPng(join(FIX, t.file)), t.quad!);
    const out = enhance(cv, page, 'bw');
    expect(out.width).toBe(page.width);
    let zeros = 0;
    let other = 0;
    for (let i = 0; i < out.data.length; i++) {
      if (i % 4 === 3) continue;
      const v = out.data[i];
      if (v === 0) zeros++;
      else if (v !== 255) other++;
    }
    expect(other).toBe(0);
    expect(zeros).toBeGreaterThan(0); // text survived
  });

  it("'magic' flattens a left->right lighting gradient (blank-row std-dev drops >= 50%)", () => {
    const img = gradientPage();
    const before = regionStats(img, 0, 320, img.width, 520);
    const out = enhance(cv, img, 'magic');
    const after = regionStats(out, 0, 320, out.width, 520);
    expect(before.std).toBeGreaterThan(20);
    expect(after.std).toBeLessThanOrEqual(before.std * 0.5);
    // Text is still dark relative to paper.
    expect(regionStats(out, 45, 82, 65, 92).mean).toBeLessThan(80);
  });

  it("'gray' returns a neutral grayscale image of the same size", () => {
    const img = gradientPage();
    const out = enhance(cv, img, 'gray');
    expect(out.width).toBe(img.width);
    expect(out.height).toBe(img.height);
    let tinted = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i] !== out.data[i + 1] || out.data[i] !== out.data[i + 2]) tinted++;
    }
    expect(tinted).toBe(0);
  });
});

describe('Mat hygiene', () => {
  it('warp and every enhance mode delete their Mats', () => {
    const img = gradientPage(400, 300);
    const t = trackMats(cv);
    try {
      warp(cv, img, [{ x: 10, y: 12 }, { x: 390, y: 8 }, { x: 395, y: 290 }, { x: 4, y: 296 }]);
      expect(t.live()).toBe(0);
      for (const mode of ['original', 'magic', 'gray', 'bw'] as FilterMode[]) {
        enhance(cv, img, mode);
        expect(t.live(), mode).toBe(0);
      }
    } finally {
      t.restore();
    }
  });

  it('the tracker catches a leaked Mat', () => {
    const t = trackMats(cv);
    try {
      const m = new cv.Mat(2, 2, cv.CV_8UC1);
      const p = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      expect(t.live()).toBe(2);
      m.delete();
      p.delete();
      expect(t.live()).toBe(0);
      // Mats returned by instance methods (MatVector.get, Mat.clone) are tracked too.
      const vec = new cv.MatVector();
      const a = new cv.Mat(2, 2, cv.CV_8UC1);
      vec.push_back(a);
      a.delete();
      const got = vec.get(0);
      const cl = got.clone();
      expect(t.live()).toBe(3);
      got.delete();
      cl.delete();
      vec.delete();
      expect(t.live()).toBe(0);
    } finally {
      t.restore();
    }
  });
});
