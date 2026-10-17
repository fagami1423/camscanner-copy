import { imageDataFromBitmap, imageDataToBlob, loadBitmap } from '../image';
import type { ExportPage } from '../pdf/pdf';
import type { Page } from '../types';

const PDF_JPEG_QUALITY = 0.85;

/**
 * Converts stored pages to PDF input: the processed image re-encoded as JPEG 0.85 at its own
 * dimensions (OCR boxes are in processed-image coordinates). OCR is attached only when done
 * and `withText` is not false.
 */
export async function toExportPages(pages: Page[], opts: { withText?: boolean } = {}): Promise<ExportPage[]> {
  const withText = opts.withText !== false;
  const out: ExportPage[] = [];
  for (const p of pages) {
    const bitmap = await loadBitmap(p.processedBlob);
    let img: ImageData;
    try {
      img = imageDataFromBitmap(bitmap);
    } finally {
      bitmap.close();
    }
    const jpeg = new Uint8Array(await (await imageDataToBlob(img, 'image/jpeg', PDF_JPEG_QUALITY)).arrayBuffer());
    const page: ExportPage = { jpeg, width: img.width, height: img.height };
    if (withText && p.ocrStatus === 'done' && p.ocr) page.ocr = p.ocr;
    out.push(page);
  }
  return out;
}
