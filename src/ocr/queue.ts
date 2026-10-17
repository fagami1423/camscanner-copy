import { getPage, updatePage, updatePageIfRev } from '../store/store';
import type { OcrResult, OcrStatus } from '../types';
import { recognize as tesseractRecognize } from './tesseract';

export interface OcrQueue {
  enqueue(pageId: string): void;
  onChange(cb: (pageId: string, status: OcrStatus) => void): () => void;
  idle(): Promise<void>;
}

export function createOcrQueue(recognize: (b: Blob) => Promise<OcrResult>): OcrQueue {
  const pending: string[] = [];
  const waiting = new Set<string>(); // waiting for its turn (not the in-flight one)
  const listeners = new Set<(pageId: string, status: OcrStatus) => void>();
  let running: Promise<void> | null = null;

  const emit = (id: string, status: OcrStatus) => {
    for (const cb of [...listeners]) {
      try { cb(id, status); } catch (e) { console.warn('ocr onChange listener threw', e); }
    }
  };

  async function runOne(id: string): Promise<void> {
    // The rev of the image being recognised. A result is written only if the page still has this rev
    // (checked in the same transaction), so a reprocess during recognition discards the stale result;
    // the reprocess has already re-enqueued the page.
    let rev: number | undefined;
    try {
      const page = await getPage(id);
      if (!page) return; // deleted while waiting: skip silently
      rev = page.rev ?? 0;
      const ocr = await recognize(page.processedBlob);
      if (await updatePageIfRev(id, rev, { ocr, ocrStatus: 'done' })) emit(id, 'done');
    } catch (e) {
      console.warn(`OCR failed for page ${id}`, e);
      let written = true;
      try {
        if (rev === undefined) await updatePage(id, { ocrStatus: 'failed' });
        else written = await updatePageIfRev(id, rev, { ocrStatus: 'failed' });
      } catch { /* best effort (page deleted or store down) */ }
      if (written) emit(id, 'failed');
    }
  }

  async function drain(): Promise<void> {
    try {
      while (pending.length) {
        const id = pending.shift() as string;
        waiting.delete(id); // from here on the id may be queued again (reprocess during OCR)
        await runOne(id);
      }
    } finally {
      running = null;
    }
  }

  return {
    enqueue(pageId) {
      if (waiting.has(pageId)) return;
      waiting.add(pageId);
      pending.push(pageId);
      if (!running) running = drain();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    idle() {
      return running ?? Promise.resolve();
    },
  };
}

/** App singleton wired to the real Tesseract worker. */
export const ocrQueue = createOcrQueue(tesseractRecognize);
