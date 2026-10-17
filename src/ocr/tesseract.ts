import type { Worker as TesseractWorker } from 'tesseract.js';
import type { OcrResult, OcrWord } from '../types';

// createWorker already runs recognition in its own Web Worker; do not nest it in another.
let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const w = await createWorker('eng', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract/',
        langPath: '/vendor/tesseract/lang',
        gzip: true,
      });
      await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO }); // '3'
      return w;
    })();
    workerPromise.catch(() => { workerPromise = null; }); // allow retry after init failure
  }
  return workerPromise;
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  try {
    return { width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}

/** Recognise `blob`; word boxes are in the input image's pixel coordinates. */
export async function recognize(blob: Blob): Promise<OcrResult> {
  const [worker, size] = await Promise.all([getWorker(), imageSize(blob)]);
  const { data } = await worker.recognize(blob, {}, { blocks: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const w of line.words) {
          if (!w.text.trim()) continue;
          words.push({
            text: w.text,
            bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
            confidence: w.confidence,
          });
        }
      }
    }
  }
  return { words, width: size.width, height: size.height };
}
