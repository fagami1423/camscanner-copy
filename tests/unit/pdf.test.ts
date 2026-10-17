import { describe, it, expect } from 'vitest';
import jpeg from 'jpeg-js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPdf, placeImage, toWinAnsi, PAGE_SIZES, type ExportPage } from '../../src/pdf/pdf';

function makeJpeg(w: number, h: number): Uint8Array {
  const data = Buffer.alloc(w * h * 4, 255);
  return new Uint8Array(jpeg.encode({ data, width: w, height: h }, 70).data);
}
const word = (text: string, x0: number, y0: number, x1: number, y1: number) => ({
  text, bbox: { x0, y0, x1, y1 }, confidence: 90,
});
function page(words: ReturnType<typeof word>[], w = 100, h = 200): ExportPage {
  return { jpeg: makeJpeg(w, h), width: w, height: h, ocr: { words, width: w, height: h } };
}
async function load(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes, disableWorker: true } as never).promise;
}

describe('placeImage', () => {
  it('fits inside and centers', () => {
    const p = placeImage(1000, 2000, 595.28, 841.89);
    expect(p.h).toBeCloseTo(841.89);
    expect(p.w).toBeCloseTo(420.945);
    expect(p.x).toBeCloseTo((595.28 - p.w) / 2);
    expect(p.y).toBeCloseTo(0);
  });
});

describe('toWinAnsi', () => {
  it('keeps ascii and latin-1, drops others', () => {
    expect(toWinAnsi('Café 12!')).toBe('Café 12!');
    expect(toWinAnsi('a→b😀')).toBe('ab');
    expect(toWinAnsi('日本')).toBe('');
  });
});

describe('buildPdf', () => {
  it('builds searchable multi-page A4 pdf', async () => {
    const bytes = await buildPdf(
      [page([word('Hello', 10, 10, 50, 30), word('World', 55, 10, 95, 30)]), page([word('Invoice', 10, 10, 60, 30)])],
      { pageSize: 'A4' },
    );
    const doc = await load(bytes);
    expect(doc.numPages).toBe(2);
    const p1 = await doc.getPage(1);
    const [, , w, h] = p1.view;
    expect(w).toBeCloseTo(PAGE_SIZES.A4[0], 1);
    expect(h).toBeCloseTo(PAGE_SIZES.A4[1], 1);
    const items = (await p1.getTextContent()).items as { str: string; transform: number[] }[];
    expect(items.map((i) => i.str).join(' ').replace(/\s+/g, ' ')).toContain('Hello World');
    const pl = placeImage(100, 200, PAGE_SIZES.A4[0], PAGE_SIZES.A4[1]);
    expect(Math.abs(items[0].transform[4] - (pl.x + 10 * pl.scale))).toBeLessThan(2);
  });
  it('strips non-WinAnsi characters', async () => {
    const bytes = await buildPdf([page([word('a→b😀', 10, 10, 60, 30)])], { pageSize: 'A4' });
    const doc = await load(bytes);
    const items = (await (await doc.getPage(1)).getTextContent()).items as { str: string }[];
    expect(items.map((i) => i.str).join('')).toBe('ab');
  });
  it('supports Letter', async () => {
    const doc = await load(await buildPdf([page([])], { pageSize: 'Letter' }));
    const [, , w, h] = (await doc.getPage(1)).view;
    expect([w, h]).toEqual([612, 792]);
  });
  it('rejects empty input', async () => {
    await expect(buildPdf([], { pageSize: 'A4' })).rejects.toThrow('No pages to export');
  });
  it('scales OCR boxes recognised at a different resolution to the image', async () => {
    // image is 100x200 but OCR ran on a 50x100 copy: boxes must be doubled
    const p: ExportPage = {
      jpeg: makeJpeg(100, 200), width: 100, height: 200,
      ocr: { words: [word('Half', 5, 5, 25, 15)], width: 50, height: 100 },
    };
    const doc = await load(await buildPdf([p], { pageSize: 'A4' }));
    const items = (await (await doc.getPage(1)).getTextContent()).items as { str: string; transform: number[]; width: number }[];
    const pl = placeImage(100, 200, PAGE_SIZES.A4[0], PAGE_SIZES.A4[1]);
    expect(items[0].str).toBe('Half');
    expect(Math.abs(items[0].transform[4] - (pl.x + 10 * pl.scale))).toBeLessThan(2);
    expect(Math.abs(items[0].transform[5] - (pl.y + (200 - 30) * pl.scale))).toBeLessThan(2);
    expect(Math.abs(items[0].width - 40 * pl.scale)).toBeLessThan(2);
  });
});

