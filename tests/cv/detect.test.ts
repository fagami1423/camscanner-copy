import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Quad } from '../../src/types';
import type { CV } from '../../src/cv/types';
import { scaleQuad } from '../../src/cv/geometry';
import { detectQuad } from '../../src/cv/detect';
import { downscale, imageData, loadCv, readPng, trackMats } from './loadCv';

const FIX = join(__dirname, '..', 'fixtures', 'generated');
const truth: { file: string; quad: Quad | null }[] = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'truth.json'), 'utf8'));

let cv: CV;
beforeAll(async () => {
  cv = await loadCv();
});

describe('detectQuad', () => {
  for (const { file, quad } of truth) {
    if (quad) {
      it(`${file}: every corner within 2% of the diagonal`, () => {
        const full = readPng(join(FIX, file));
        const { img, scale } = downscale(cv, full, 480);
        const q = detectQuad(cv, img);
        expect(q).not.toBeNull();
        const back = scaleQuad(q!, 1 / scale);
        const diag = Math.hypot(full.width, full.height);
        const errs = back.map((p, i) => Math.hypot(p.x - quad[i].x, p.y - quad[i].y) / diag);
        console.log(`${file} corner error (% diag): ${errs.map((e) => (e * 100).toFixed(2)).join(', ')}`);
        for (const e of errs) expect(e).toBeLessThan(0.02);
      });
    } else {
      it(`${file}: returns null`, () => {
        const { img } = downscale(cv, readPng(join(FIX, file)), 480);
        expect(detectQuad(cv, img)).toBeNull();
      });
    }
  }

  it('deletes every Mat it allocates', () => {
    const { img } = downscale(cv, readPng(join(FIX, 'dark-desk.png')), 480);
    const { img: none } = downscale(cv, readPng(join(FIX, 'no-page.png')), 480);
    const t = trackMats(cv);
    try {
      detectQuad(cv, img);
      expect(t.live()).toBe(0);
      detectQuad(cv, none); // exercises the Otsu fallback path too
      expect(t.live()).toBe(0);
    } finally {
      t.restore();
    }
  });
});

describe('detectQuad whole-frame artifacts', () => {
  it('the low-contrast light-desk fixture has a ground-truth page (detected above)', () => {
    expect(truth.find((t) => t.file === 'light-desk.png')?.quad).toBeTruthy();
  });

  it('returns null for a frame filled edge-to-edge by a text page (no page border visible)', () => {
    const w = 360, h = 480;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ink = y % 11 < 4 && x % 37 < 28;
        const v = ink ? 20 : 235;
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    expect(detectQuad(cv, imageData(d, w, h))).toBeNull();
  });
});
