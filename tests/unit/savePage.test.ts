import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/image', async () => {
  const actual = await vi.importActual<typeof import('../../src/image')>('../../src/image');
  return {
    fitWithin: actual.fitWithin,
    loadBitmap: vi.fn(async () => ({ width: 8000, height: 6000, close: vi.fn() })),
    imageDataFromBitmap: vi.fn((b: { width: number; height: number }, maxSide?: number) => {
      const { width, height } = maxSide ? actual.fitWithin(b.width, b.height, maxSide) : b;
      return { width, height, data: new Uint8ClampedArray(0) };
    }),
    imageDataToBlob: vi.fn(async () => new Blob(['processed'], { type: 'image/jpeg' })),
    makeThumb: vi.fn(async () => new Blob(['thumb'], { type: 'image/jpeg' })),
  };
});

import * as store from '../../src/store/store';
import { savePage, reprocessPage, saveRawPage } from '../../src/pages/savePage';
import * as image from '../../src/image';
import { fullFrameQuad } from '../../src/cv/geometry';
import type { FilterMode, Quad } from '../../src/types';

const mkCv = (detected: Quad | null) => ({
  detect: vi.fn(async () => detected),
  warp: vi.fn(async (img: ImageData, _q: Quad) => ({ ...img, width: 100, height: 50 }) as ImageData),
  enhance: vi.fn(async (img: ImageData, _m: FilterMode) => img),
});
const original = new Blob(['original-bytes'], { type: 'image/jpeg' });
const q: Quad = [{ x: 100, y: 100 }, { x: 7000, y: 200 }, { x: 6900, y: 5000 }, { x: 150, y: 5100 }];

let docId: string;
beforeEach(async () => {
  await store._resetForTests();
  docId = (await store.createDocument()).id;
  vi.clearAllMocks();
});

describe('savePage', () => {
  it('detects on a 480px copy, scales the quad up to full-res', async () => {
    const det: Quad = [{ x: 10, y: 10 }, { x: 470, y: 10 }, { x: 470, y: 350 }, { x: 10, y: 350 }];
    const cv = mkCv(det);
    const enqueue = vi.fn();
    const page = await savePage(docId, original, { cv, enqueue });
    expect(cv.detect).toHaveBeenCalledOnce();
    const f = 8000 / 480;
    expect(page.quad[1].x).toBeCloseTo(470 * f);
    expect(page.quad[2].y).toBeCloseTo(350 * f);
    expect(page.filter).toBe('magic');
    expect(page.ocrStatus).toBe('pending');
    expect(page.ocr).toBeUndefined();
    // warp receives quad scaled by the 4000px decode factor (0.5)
    const warpQuad = cv.warp.mock.calls[0][1] as Quad;
    expect(warpQuad[1].x).toBeCloseTo(page.quad[1].x * 0.5);
    expect(cv.enhance.mock.calls[0][1]).toBe('magic');
  });

  it('falls back to full frame when detect returns null or invalid', async () => {
    const page = await savePage(docId, original, { cv: mkCv(null), enqueue: vi.fn() });
    expect(page.quad).toEqual(fullFrameQuad(8000, 6000));
    const tiny: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const page2 = await savePage(docId, original, { cv: mkCv(tiny), enqueue: vi.fn() });
    expect(page2.quad).toEqual(fullFrameQuad(8000, 6000));
  });

  it('uses fallbackQuad (the live quad) when still detection returns null or invalid', async () => {
    const live: Quad = [{ x: 400, y: 300 }, { x: 7600, y: 300 }, { x: 7600, y: 5700 }, { x: 400, y: 5700 }];
    const page = await savePage(docId, original, { cv: mkCv(null), fallbackQuad: live, enqueue: vi.fn() });
    expect(page.quad).toEqual(live);
    const tiny: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const page2 = await savePage(docId, original, { cv: mkCv(tiny), fallbackQuad: live, enqueue: vi.fn() });
    expect(page2.quad).toEqual(live);
  });

  it('resolves a fallbackQuad function against the still dimensions', async () => {
    const live: Quad = [{ x: 400, y: 300 }, { x: 7600, y: 300 }, { x: 7600, y: 5700 }, { x: 400, y: 5700 }];
    const resolve = vi.fn(() => live);
    const page = await savePage(docId, original, { cv: mkCv(null), fallbackQuad: resolve, enqueue: vi.fn() });
    expect(resolve).toHaveBeenCalledWith(8000, 6000);
    expect(page.quad).toEqual(live);
  });

  it('a detected still quad wins over fallbackQuad; an invalid fallback falls through to full frame', async () => {
    const det: Quad = [{ x: 10, y: 10 }, { x: 470, y: 10 }, { x: 470, y: 350 }, { x: 10, y: 350 }];
    const live: Quad = [{ x: 400, y: 300 }, { x: 7600, y: 300 }, { x: 7600, y: 5700 }, { x: 400, y: 5700 }];
    const page = await savePage(docId, original, { cv: mkCv(det), fallbackQuad: live, enqueue: vi.fn() });
    expect(page.quad[1].x).toBeCloseTo(470 * (8000 / 480));
    const bad: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const page2 = await savePage(docId, original, { cv: mkCv(null), fallbackQuad: bad, enqueue: vi.fn() });
    expect(page2.quad).toEqual(fullFrameQuad(8000, 6000));
  });

  it('skips detect with a provided quad, stores it, appends and enqueues', async () => {
    const cv = mkCv(null);
    const enqueue = vi.fn();
    const page = await savePage(docId, original, { quad: q, filter: 'bw', cv, enqueue });
    expect(cv.detect).not.toHaveBeenCalled();
    expect(page.quad).toEqual(q);
    expect(cv.enhance.mock.calls[0][1]).toBe('bw');
    expect(enqueue).toHaveBeenCalledWith(page.id);
    expect((await store.getDocument(docId))!.pageIds).toEqual([page.id]);
    expect(image.imageDataToBlob).toHaveBeenCalledWith(expect.anything(), 'image/jpeg', 0.9);
  });
});

describe('reprocessPage', () => {
  it('keeps original bytes, applies filter, resets ocr and enqueues', async () => {
    const cv = mkCv(null);
    const page = await savePage(docId, original, { quad: q, cv, enqueue: vi.fn() });
    await store.updatePage(page.id, {
      ocrStatus: 'done',
      ocr: { words: [], width: 1, height: 1 },
    });
    const enqueue = vi.fn();
    const out = await reprocessPage(page.id, { filter: 'gray' }, cv, { enqueue });
    expect(out.filter).toBe('gray');
    expect(out.quad).toEqual(q);
    expect(out.ocrStatus).toBe('pending');
    expect(out.ocr).toBeUndefined();
    expect(page.rev).toBe(0);
    expect(out.rev).toBe(1); // invalidates OCR still running on the previous image
    expect(await out.originalBlob.text()).toBe('original-bytes');
    expect(enqueue).toHaveBeenCalledWith(page.id);
    const stored = (await store.getPage(page.id))!;
    expect(stored.filter).toBe('gray');
    expect(stored.ocr).toBeUndefined();
  });

  it('applies a new quad and keeps the stored filter', async () => {
    const cv = mkCv(null);
    const page = await savePage(docId, original, { quad: q, filter: 'bw', cv, enqueue: vi.fn() });
    const nq = fullFrameQuad(8000, 6000);
    const out = await reprocessPage(page.id, { quad: nq }, cv, { enqueue: vi.fn() });
    expect(out.quad).toEqual(nq);
    expect(out.filter).toBe('bw');
  });
});

describe('saveRawPage (no CV)', () => {
  it('stores the full frame unprocessed: original filter, <=3000px JPEG 0.9, thumb, pending OCR, enqueued', async () => {
    const enqueue = vi.fn();
    const page = await saveRawPage(docId, original, { enqueue });
    expect(page.quad).toEqual(fullFrameQuad(8000, 6000));
    expect(page.filter).toBe('original');
    expect(page.ocrStatus).toBe('pending');
    expect(await page.processedBlob.text()).toBe('processed');
    expect(await page.thumbBlob.text()).toBe('thumb');
    expect(await page.originalBlob.text()).toBe('original-bytes');
    expect(image.imageDataFromBitmap).toHaveBeenCalledWith(expect.anything(), 3000);
    const encoded = vi.mocked(image.imageDataToBlob).mock.calls[0];
    expect([encoded[0].width, encoded[0].height]).toEqual([3000, 2250]);
    expect(encoded.slice(1)).toEqual(['image/jpeg', 0.9]);
    expect(image.makeThumb).toHaveBeenCalledWith(expect.anything(), 256);
    const bmp = await vi.mocked(image.loadBitmap).mock.results[0].value;
    expect(bmp.close).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(page.id);
    expect((await store.getDocument(docId))!.pageIds).toEqual([page.id]);
  });
});
