import type { Page } from '../types';
import { ocrQueue } from './queue';

// Pages handed to the OCR queue during this session; a 'pending' page not in here was left
// pending by an earlier session (tab closed mid-OCR) and needs re-enqueueing.
const known = new Set<string>();

export function enqueueOcr(pageId: string): void {
  known.add(pageId);
  ocrQueue.enqueue(pageId);
}

export function resumePendingOcr(pages: Page[]): void {
  for (const p of pages) if (p.ocrStatus === 'pending' && !known.has(p.id)) enqueueOcr(p.id);
}
