import {
  PDFDocument, StandardFonts, TextRenderingMode, setTextRenderingMode,
  pushGraphicsState, popGraphicsState,
} from 'pdf-lib';
import type { OcrResult } from '../types';

export interface ExportPage { jpeg: Uint8Array; width: number; height: number; ocr?: OcrResult }

export const PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792] } as const;

export function placeImage(imgW: number, imgH: number, pageW: number, pageH: number) {
  const scale = Math.min(pageW / imgW, pageH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (pageW - w) / 2, y: (pageH - h) / 2, w, h, scale };
}

// Characters encodable in WinAnsi (cp1252): ASCII printable, Latin-1 upper half, and the 0x80-0x9F extras.
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
let winAnsiSet: Set<number> | null = null;

function getWinAnsiSet(): Set<number> {
  if (winAnsiSet) return winAnsiSet;
  const set = new Set<number>();
  for (let c = 0x20; c <= 0x7e; c++) set.add(c);
  for (let c = 0xa0; c <= 0xff; c++) set.add(c);
  for (const ch of WIN_ANSI_EXTRAS) set.add(ch.codePointAt(0)!);
  return (winAnsiSet = set);
}

/** Drop characters Helvetica's WinAnsi encoding cannot encode (iterates by code point). */
export function toWinAnsi(s: string): string {
  const set = getWinAnsiSet();
  let out = '';
  for (const ch of s) if (set.has(ch.codePointAt(0)!)) out += ch;
  return out;
}

export async function buildPdf(pages: ExportPage[], opts: { pageSize: 'A4' | 'Letter' }): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('No pages to export');
  const [pw, ph] = PAGE_SIZES[opts.pageSize];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const p of pages) {
    const page = doc.addPage([pw, ph]);
    const img = await doc.embedJpg(p.jpeg);
    const pl = placeImage(p.width, p.height, pw, ph);
    page.drawImage(img, { x: pl.x, y: pl.y, width: pl.w, height: pl.h });
    if (!p.ocr) continue;
    // OCR boxes are in the pixel space OCR ran on; map them to this image if it differs.
    const sx = p.ocr.width > 0 ? p.width / p.ocr.width : 1;
    const sy = p.ocr.height > 0 ? p.height / p.ocr.height : 1;
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    for (const ow of p.ocr.words) {
      const w = { text: ow.text, bbox: { x0: ow.bbox.x0 * sx, y0: ow.bbox.y0 * sy, x1: ow.bbox.x1 * sx, y1: ow.bbox.y1 * sy } };
      const text = toWinAnsi(w.text);
      const bw = w.bbox.x1 - w.bbox.x0;
      const bh = w.bbox.y1 - w.bbox.y0;
      if (!text || !(bw > 0) || !(bh > 0)) continue;
      const unit = font.widthOfTextAtSize(text, 1);
      if (!(unit > 0)) continue;
      page.drawText(text, {
        font,
        size: (bw * pl.scale) / unit,
        x: pl.x + w.bbox.x0 * pl.scale,
        y: pl.y + (p.height - w.bbox.y1) * pl.scale,
      });
    }
    page.pushOperators(popGraphicsState());
  }
  return doc.save();
}
