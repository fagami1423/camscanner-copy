import { getCv } from '../cv/client';
import type { CvApi } from '../cv/client';
import { fullFrameQuad, isValidQuad, scaleQuad } from '../cv/geometry';
import { imageDataFromBitmap, imageDataToBlob, loadBitmap, makeThumb } from '../image';
import { ocrQueue } from '../ocr/queue';
import { addPage, getPage, updatePage } from '../store/store';
import type { FilterMode, Page, Quad } from '../types';

type Cv = Pick<CvApi, 'detect' | 'warp' | 'enhance'>;
interface Opts {
  enqueue?: (pageId: string) => void;
}
/**
 * Quad (full-res original coords) used when detection on the still finds nothing valid, before
 * falling back to the full frame. A function is called with the decoded still's size (e.g. to scale
 * the live preview quad onto it) and may return undefined to skip.
 */
export type FallbackQuad = Quad | ((stillW: number, stillH: number) => Quad | undefined);

const DECODE_MAX = 4000;
const DETECT_MAX = 480;
const RAW_MAX = 3000;

async function derive(
  original: Blob,
  cv: Cv,
  filter: FilterMode,
  quadIn: Quad | undefined,
  fallback?: FallbackQuad,
): Promise<{ quad: Quad; processedBlob: Blob; thumbBlob: Blob }> {
  const bitmap = await loadBitmap(original);
  try {
    const fullW = bitmap.width;
    const fullH = bitmap.height;
    let quad = quadIn;
    if (!quad) {
      const small = imageDataFromBitmap(bitmap, DETECT_MAX);
      const sw = small.width;
      const found = await cv.detect(small); // small is transferred; not reused
      const up = found ? scaleQuad(found, fullW / sw) : null;
      const fb = typeof fallback === 'function' ? fallback(fullW, fullH) : fallback;
      quad =
        up && isValidQuad(up, fullW, fullH)
          ? up
          : fb && isValidQuad(fb, fullW, fullH)
            ? fb
            : fullFrameQuad(fullW, fullH);
    }
    const work = imageDataFromBitmap(bitmap, DECODE_MAX);
    const factor = work.width / fullW;
    const warped = await cv.warp(work, scaleQuad(quad, factor));
    const enhanced = await cv.enhance(warped, filter);
    const processedBlob = await imageDataToBlob(enhanced, 'image/jpeg', 0.9);
    const thumbBlob = await makeThumb(enhanced, 256);
    return { quad, processedBlob, thumbBlob };
  } finally {
    bitmap.close();
  }
}

export async function savePage(
  docId: string,
  original: Blob,
  opts: { quad?: Quad; filter?: FilterMode; cv?: Cv; fallbackQuad?: FallbackQuad } & Opts = {},
): Promise<Page> {
  const cv = opts.cv ?? getCv();
  const filter = opts.filter ?? 'magic';
  const { quad, processedBlob, thumbBlob } = await derive(original, cv, filter, opts.quad, opts.fallbackQuad);
  const page = await addPage(docId, {
    originalBlob: original,
    quad,
    filter,
    processedBlob,
    thumbBlob,
    ocrStatus: 'pending',
  });
  (opts.enqueue ?? ((id) => ocrQueue.enqueue(id)))(page.id);
  return page;
}

export async function reprocessPage(
  pageId: string,
  patch: { quad?: Quad; filter?: FilterMode },
  cv: Cv = getCv(),
  opts: Opts = {},
): Promise<Page> {
  const page = await getPage(pageId);
  if (!page) throw new Error(`Page not found: ${pageId}`);
  const filter = patch.filter ?? page.filter;
  const { quad, processedBlob, thumbBlob } = await derive(page.originalBlob, cv, filter, patch.quad ?? page.quad);
  const next = await updatePage(
    pageId,
    { quad, filter, processedBlob, thumbBlob, ocrStatus: 'pending', ocr: undefined },
    { bumpRev: true }, // invalidates any in-flight OCR of the previous image
  );
  (opts.enqueue ?? ((id) => ocrQueue.enqueue(id)))(pageId);
  return next;
}

/**
 * Saves a capture without CV (fallback when the scanner engine failed to load): full-frame quad,
 * 'original' filter, image downscaled to <= 3000 px long side as JPEG 0.9. OCR is still enqueued.
 */
export async function saveRawPage(docId: string, original: Blob, opts: Opts = {}): Promise<Page> {
  const bitmap = await loadBitmap(original);
  let fullW: number;
  let fullH: number;
  let img: ImageData;
  try {
    fullW = bitmap.width;
    fullH = bitmap.height;
    img = imageDataFromBitmap(bitmap, RAW_MAX);
  } finally {
    bitmap.close();
  }
  const processedBlob = await imageDataToBlob(img, 'image/jpeg', 0.9);
  const thumbBlob = await makeThumb(img, 256);
  const page = await addPage(docId, {
    originalBlob: original,
    quad: fullFrameQuad(fullW, fullH),
    filter: 'original',
    processedBlob,
    thumbBlob,
    ocrStatus: 'pending',
  });
  (opts.enqueue ?? ((id) => ocrQueue.enqueue(id)))(page.id);
  return page;
}
