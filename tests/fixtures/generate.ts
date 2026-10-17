/**
 * Deterministic synthetic fixture generator for CV tests.
 * Run: npm run fixtures  (npx tsx tests/fixtures/generate.ts); vitest's globalSetup also runs it
 * when tests/fixtures/generated/ is missing or stale. PNGs are git-ignored; truth.json is committed.
 *
 * Renders a 1200x1600 white "page" (title `INVOICE 2026` + text-like bars), perspective-warps it
 * onto a 1440x1920 background at a known quad, and writes PNGs plus truth.json.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Quad } from '../../src/types';
import type { CV } from '../../src/cv/types';
import { imageData, loadCv, writePng } from '../cv/loadCv';

const SELF = fileURLToPath(import.meta.url);
/** Committed: generator + truth.json. */
export const FIXTURE_DIR = dirname(SELF);
/** Git-ignored: generated PNGs + a hash stamp of the generator that produced them. */
export const GENERATED_DIR = join(FIXTURE_DIR, 'generated');
const STAMP = '.generator-hash';
const NAMES = ['dark-desk', 'light-desk', 'steep-angle', 'crumpled', 'no-page'];
const PAGE_W = 1200;
const PAGE_H = 1600;
const OUT_W = 1440;
const OUT_H = 1920;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** RGB float buffer helpers (3 channels, row-major). */
type Rgb = Float32Array;

function renderPage(cv: CV, rand: () => number): Rgb {
  const page = new cv.Mat(PAGE_H, PAGE_W, cv.CV_8UC3, new cv.Scalar(255, 255, 255));
  try {
    const black = new cv.Scalar(20, 20, 20);
    // ~80 px cap height title, heavy stroke so OCR can read it later.
    cv.putText(page, 'INVOICE 2026', new cv.Point(110, 210), cv.FONT_HERSHEY_SIMPLEX, 3.6, black, 10, cv.LINE_AA);
    // Rule under the title.
    cv.rectangle(page, new cv.Point(110, 260), new cv.Point(1090, 266), black, -1);
    // Text-like bars: lines of word-sized blocks.
    for (let y = 340; y < PAGE_H - 140; y += 44) {
      if (rand() < 0.12) continue; // paragraph gap
      let x = 110;
      const lineEnd = 1090 - (rand() < 0.2 ? rand() * 500 : 0);
      while (x < lineEnd) {
        const w = 30 + rand() * 120;
        const x2 = Math.min(x + w, lineEnd);
        cv.rectangle(page, new cv.Point(Math.round(x), y), new cv.Point(Math.round(x2), y + 16), black, -1);
        x = x2 + 14 + rand() * 10;
      }
    }
    return Float32Array.from(page.data);
  } finally {
    page.delete();
  }
}

function solidBg(rgb: [number, number, number], sigma: number, rand: () => number): Rgb {
  const out = new Float32Array(OUT_W * OUT_H * 3);
  for (let i = 0; i < OUT_W * OUT_H; i++) {
    const n = gauss(rand) * sigma;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = rgb[c] + n + gauss(rand) * sigma * 0.3;
  }
  return out;
}

/** Wood-grain-like texture: low-frequency value noise + grain stripes + pixel noise. */
function texturedBg(cv: CV, rand: () => number): Rgb {
  const small = new cv.Mat(24, 18, cv.CV_32FC1);
  const big = new cv.Mat();
  try {
    for (let i = 0; i < small.data32F.length; i++) small.data32F[i] = rand();
    cv.resize(small, big, new cv.Size(OUT_W, OUT_H), 0, 0, cv.INTER_CUBIC);
    const lf = big.data32F as Float32Array;
    const out = new Float32Array(OUT_W * OUT_H * 3);
    const base = [125, 92, 62];
    for (let y = 0; y < OUT_H; y++) {
      for (let x = 0; x < OUT_W; x++) {
        const i = y * OUT_W + x;
        const warpX = x + 40 * lf[i];
        const grain = 0.5 + 0.5 * Math.sin(warpX * 0.09 + Math.sin(y * 0.004) * 6);
        const v = 0.75 + 0.35 * lf[i] + 0.12 * grain + gauss(rand) * 0.03;
        for (let c = 0; c < 3; c++) out[i * 3 + c] = base[c] * v;
      }
    }
    // Scatter some darker knots/streaks.
    for (let k = 0; k < 14; k++) {
      const cx = rand() * OUT_W, cy = rand() * OUT_H, r = 20 + rand() * 80;
      for (let y = Math.max(0, Math.floor(cy - r * 3)); y < Math.min(OUT_H, cy + r * 3); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(OUT_W, cx + r); x++) {
          const d = ((x - cx) / r) ** 2 + ((y - cy) / (r * 3)) ** 2;
          if (d < 1) for (let c = 0; c < 3; c++) out[(y * OUT_W + x) * 3 + c] *= 0.8 + 0.2 * d;
        }
      }
    }
    return out;
  } finally {
    small.delete();
    big.delete();
  }
}

interface PlaceOpts {
  /** Edge displacement amplitude in px (sinusoidal remap), 0 = flat. */
  wobble?: number;
  /** Shading gradient: multiplier at TL corner -> at BR corner of the output. */
  shade?: [number, number];
}

/** Warp page onto bg at quad; returns composite RGB float. */
function place(cv: CV, page: Rgb, bg: Rgb, q: Quad, opts: PlaceOpts = {}): Rgb {
  const pageMat = new cv.Mat(PAGE_H, PAGE_W, cv.CV_32FC3);
  pageMat.data32F.set(page);
  const mask = new cv.Mat(PAGE_H, PAGE_W, cv.CV_32FC1, new cv.Scalar(1));
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, PAGE_W, 0, PAGE_W, PAGE_H, 0, PAGE_H]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap((p) => [p.x, p.y]));
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const wPage = new cv.Mat();
  const wMask = new cv.Mat();
  const mapX = new cv.Mat();
  const mapY = new cv.Mat();
  const tmp = new cv.Mat();
  try {
    const size = new cv.Size(OUT_W, OUT_H);
    const zero = new cv.Scalar(0, 0, 0, 0);
    cv.warpPerspective(pageMat, wPage, M, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, zero);
    cv.warpPerspective(mask, wMask, M, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, zero);
    if (opts.wobble) {
      const a = opts.wobble;
      mapX.create(OUT_H, OUT_W, cv.CV_32FC1);
      mapY.create(OUT_H, OUT_W, cv.CV_32FC1);
      const mx = mapX.data32F as Float32Array;
      const my = mapY.data32F as Float32Array;
      for (let y = 0; y < OUT_H; y++) {
        for (let x = 0; x < OUT_W; x++) {
          const i = y * OUT_W + x;
          mx[i] = x + a * Math.sin((2 * Math.PI * y) / 310 + 0.7);
          my[i] = y + a * Math.sin((2 * Math.PI * x) / 270 + 1.9);
        }
      }
      cv.remap(wPage, tmp, mapX, mapY, cv.INTER_LINEAR, cv.BORDER_CONSTANT, zero);
      tmp.copyTo(wPage);
      cv.remap(wMask, tmp, mapX, mapY, cv.INTER_LINEAR, cv.BORDER_CONSTANT, zero);
      tmp.copyTo(wMask);
    }
    const pg = wPage.data32F as Float32Array;
    const mk = wMask.data32F as Float32Array;
    const out = new Float32Array(OUT_W * OUT_H * 3);
    const [s0, s1] = opts.shade ?? [1, 1];
    for (let y = 0; y < OUT_H; y++) {
      for (let x = 0; x < OUT_W; x++) {
        const i = y * OUT_W + x;
        const t = (x / OUT_W + y / OUT_H) / 2;
        const shade = s0 + (s1 - s0) * t;
        const al = mk[i];
        for (let c = 0; c < 3; c++) out[i * 3 + c] = bg[i * 3 + c] * (1 - al) + pg[i * 3 + c] * shade * al;
      }
    }
    return out;
  } finally {
    for (const m of [pageMat, mask, srcPts, dstPts, M, wPage, wMask, mapX, mapY, tmp]) m.delete();
  }
}

/** Add camera-like sensor noise + slight softness, quantise to RGBA ImageData. */
function finish(cv: CV, rgb: Rgb, rand: () => number, sigma = 3): ImageData {
  const rgba = new Uint8ClampedArray(OUT_W * OUT_H * 4);
  for (let i = 0; i < OUT_W * OUT_H; i++) {
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = rgb[i * 3 + c] + gauss(rand) * sigma;
    rgba[i * 4 + 3] = 255;
  }
  const m = cv.matFromImageData(imageData(rgba, OUT_W, OUT_H));
  try {
    cv.GaussianBlur(m, m, new cv.Size(3, 3), 0);
    return imageData(new Uint8ClampedArray(m.data), OUT_W, OUT_H);
  } finally {
    m.delete();
  }
}

const q = (pts: [number, number][]): Quad => pts.map(([x, y]) => ({ x, y })) as Quad;

/** Hash of everything that determines the fixture pixels. */
export function generatorHash(): string {
  const h = createHash('sha256');
  h.update(readFileSync(SELF));
  h.update(readFileSync(join(FIXTURE_DIR, '..', 'cv', 'loadCv.ts')));
  h.update(readFileSync(join(FIXTURE_DIR, '..', '..', 'node_modules', '@techstark', 'opencv-js', 'package.json')));
  return h.digest('hex');
}

/** True when every generated PNG exists and was produced by the current generator. */
export function fixturesUpToDate(outDir = GENERATED_DIR): boolean {
  const stamp = join(outDir, STAMP);
  return (
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8').trim() === generatorHash() &&
    NAMES.every((n) => existsSync(join(outDir, `${n}.png`)))
  );
}

export async function generateFixtures(outDir = GENERATED_DIR): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const cv = await loadCv();
  const truth: { file: string; quad: Quad | null }[] = [];
  const emit = (name: string, img: ImageData, quad: Quad | null) => {
    writePng(join(outDir, `${name}.png`), img);
    truth.push({ file: `${name}.png`, quad });
    console.log(`wrote ${name}.png`);
  };

  {
    const rand = mulberry32(101);
    const quad = q([[230, 262], [1228, 318], [1272, 1684], [168, 1612]]);
    const page = renderPage(cv, rand);
    const bg = solidBg([40, 35, 30], 9, rand);
    emit('dark-desk', finish(cv, place(cv, page, bg, quad), rand), quad);
  }
  {
    const rand = mulberry32(202);
    const quad = q([[182, 222], [1248, 198], [1290, 1702], [148, 1724]]);
    const page = renderPage(cv, rand);
    const bg = solidBg([200, 195, 185], 4, rand);
    // Low contrast: soft room light, page slightly dimmed toward the bottom right.
    emit('light-desk', finish(cv, place(cv, page, bg, quad, { shade: [0.97, 0.9] }), rand), quad);
  }
  {
    const rand = mulberry32(303);
    // Top edge ~682 px vs bottom ~1240 px (55%).
    const quad = q([[380, 432], [1062, 410], [1350, 1792], [110, 1812]]);
    const page = renderPage(cv, rand);
    const bg = solidBg([70, 60, 52], 7, rand);
    emit('steep-angle', finish(cv, place(cv, page, bg, quad, { shade: [0.95, 0.85] }), rand), quad);
  }
  {
    const rand = mulberry32(404);
    const quad = q([[204, 244], [1236, 212], [1262, 1698], [176, 1730]]);
    const page = renderPage(cv, rand);
    const bg = solidBg([105, 82, 60], 8, rand);
    emit('crumpled', finish(cv, place(cv, page, bg, quad, { wobble: 6, shade: [1.0, 0.68] }), rand), quad);
  }
  {
    const rand = mulberry32(505);
    emit('no-page', finish(cv, texturedBg(cv, rand), rand), null);
  }

  writeFileSync(join(FIXTURE_DIR, 'truth.json'), JSON.stringify(truth, null, 2) + '\n');
  writeFileSync(join(outDir, STAMP), generatorHash() + '\n');
  console.log('wrote truth.json');
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  generateFixtures().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
