import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/image', () => ({
  loadBitmap: vi.fn(async (b: Blob) => {
    const [w, h] = (await b.text()).split('x').map(Number);
    return { width: w, height: h, close: vi.fn() };
  }),
  imageDataFromBitmap: vi.fn((b: { width: number; height: number }) => ({ width: b.width, height: b.height, data: new Uint8ClampedArray(0) })),
  imageDataToBlob: vi.fn(async (img: ImageData) => new Blob([`jpeg:${img.width}`], { type: 'image/jpeg' })),
}));

import { toExportPages } from '../../src/pages/exportDoc';
import * as image from '../../src/image';
import type { OcrResult, Page } from '../../src/types';

const ocr: OcrResult = { words: [{ text: 'INVOICE', bbox: { x0: 1, y0: 1, x1: 5, y1: 3 }, confidence: 90 }], width: 300, height: 400 };
const mkPage = (id: string, dims: string, extra: Partial<Page> = {}): Page =>
  ({
    id, docId: 'd', originalBlob: new Blob(['o']), quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    filter: 'magic', processedBlob: new Blob([dims]), thumbBlob: new Blob(['t']), ocrStatus: 'pending', ...extra,
  }) as Page;

beforeEach(() => vi.clearAllMocks());

describe('toExportPages', () => {
  it('re-encodes each processed image as JPEG 0.85 with processed dims, in order', async () => {
    const out = await toExportPages([mkPage('a', '300x400'), mkPage('b', '640x480')]);
    expect(out.map((p) => [p.width, p.height])).toEqual([[300, 400], [640, 480]]);
    expect(new TextDecoder().decode(out[0].jpeg)).toBe('jpeg:300');
    expect(new TextDecoder().decode(out[1].jpeg)).toBe('jpeg:640');
    expect(out[0].jpeg).toBeInstanceOf(Uint8Array);
    for (const c of vi.mocked(image.imageDataToBlob).mock.calls) {
      expect(c[1]).toBe('image/jpeg');
      expect(c[2]).toBe(0.85);
    }
    const bitmaps = await Promise.all(vi.mocked(image.loadBitmap).mock.results.map((r) => r.value));
    for (const b of bitmaps) expect(b.close).toHaveBeenCalled();
  });

  it('passes OCR only for pages whose OCR is done', async () => {
    const out = await toExportPages([
      mkPage('a', '300x400', { ocrStatus: 'done', ocr }),
      mkPage('b', '300x400', { ocrStatus: 'failed' }),
      mkPage('c', '300x400', { ocrStatus: 'pending', ocr }),
    ]);
    expect(out[0].ocr).toEqual(ocr);
    expect(out[1].ocr).toBeUndefined();
    expect(out[2].ocr).toBeUndefined();
  });

  it('omits OCR entirely when withText is false', async () => {
    const out = await toExportPages([mkPage('a', '300x400', { ocrStatus: 'done', ocr })], { withText: false });
    expect(out[0].ocr).toBeUndefined();
  });
});
