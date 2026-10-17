import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../../src/store/store';
import { createOcrQueue } from '../../src/ocr/queue';
import type { OcrResult, OcrStatus, Page } from '../../src/types';

const pt = { x: 0, y: 0 };
const mkPage = (tag: string): Omit<Page, 'id' | 'docId' | 'rev'> => ({
  originalBlob: new Blob(['orig'], { type: 'image/jpeg' }),
  quad: [pt, pt, pt, pt],
  filter: 'original',
  processedBlob: new Blob([tag], { type: 'image/jpeg' }),
  thumbBlob: new Blob(['thumb'], { type: 'image/jpeg' }),
  ocrStatus: 'pending',
});
const result = (w: string): OcrResult => ({
  words: [{ text: w, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 }, confidence: 90 }],
  width: 10,
  height: 20,
});
const tick = () => new Promise((r) => setTimeout(r, 0));

let docId: string;
beforeEach(async () => {
  await store._resetForTests();
  docId = (await store.createDocument()).id;
});

describe('ocr queue', () => {
  it('runs pages sequentially and writes done + ocr', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const b = await store.addPage(docId, mkPage('b'));
    const started: string[] = [];
    const resolvers: Array<() => void> = [];
    const recognize = vi.fn(async (blob: Blob) => {
      const tag = await blob.text();
      started.push(tag);
      await new Promise<void>((r) => resolvers.push(r));
      return result(tag);
    });
    const q = createOcrQueue(recognize);
    const changes: Array<[string, OcrStatus]> = [];
    q.onChange((id, s) => changes.push([id, s]));
    q.enqueue(a.id);
    q.enqueue(b.id);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    await tick(); await tick();
    expect(started).toEqual(['a']);
    resolvers[0]();
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    resolvers[1]();
    await q.idle();
    const pa = await store.getPage(a.id);
    expect(pa?.ocrStatus).toBe('done');
    expect(pa?.ocr?.words[0].text).toBe('a');
    expect((await store.getPage(b.id))?.ocrStatus).toBe('done');
    expect(changes).toEqual([[a.id, 'done'], [b.id, 'done']]);
  });

  it('marks failed on rejection and continues with the next item', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const b = await store.addPage(docId, mkPage('b'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const recognize = vi.fn(async (blob: Blob) => {
      const tag = await blob.text();
      if (tag === 'a') throw new Error('boom');
      return result(tag);
    });
    const q = createOcrQueue(recognize);
    const changes: Array<[string, OcrStatus]> = [];
    q.onChange((id, s) => changes.push([id, s]));
    q.enqueue(a.id);
    q.enqueue(b.id);
    await q.idle();
    expect((await store.getPage(a.id))?.ocrStatus).toBe('failed');
    expect((await store.getPage(b.id))?.ocrStatus).toBe('done');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([[a.id, 'failed'], [b.id, 'done']]);
    warn.mockRestore();
  });

  it('idle() resolves immediately when empty', async () => {
    const q = createOcrQueue(async () => result('x'));
    await expect(q.idle()).resolves.toBeUndefined();
  });

  it('enqueuing an already-waiting id is a no-op', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const b = await store.addPage(docId, mkPage('b'));
    const recognize = vi.fn(async (blob: Blob) => result(await blob.text()));
    const q = createOcrQueue(recognize);
    q.enqueue(a.id); // starts immediately (in flight)
    q.enqueue(b.id);
    q.enqueue(b.id); // b is waiting -> no-op
    await q.idle();
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it('skips pages that no longer exist and continues', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const b = await store.addPage(docId, mkPage('b'));
    await store.deletePage(a.id);
    const recognize = vi.fn(async (blob: Blob) => result(await blob.text()));
    const q = createOcrQueue(recognize);
    const changes: string[] = [];
    q.onChange((id) => changes.push(id));
    q.enqueue(a.id);
    q.enqueue(b.id);
    await q.idle();
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([b.id]);
  });

  it('onChange unsubscribe stops notifications', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const q = createOcrQueue(async () => result('a'));
    const cb = vi.fn();
    q.onChange(cb)();
    q.enqueue(a.id);
    await q.idle();
    expect(cb).not.toHaveBeenCalled();
  });

  it('getPage rejecting fails that item, continues, idle resolves', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const b = await store.addPage(docId, mkPage('b'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = store.getPage;
    const spy = vi.spyOn(store, 'getPage').mockImplementation(async (id: string) => {
      if (id === a.id) throw new Error('idb down');
      return real(id);
    });
    const q = createOcrQueue(async (blob) => result(await blob.text()));
    const changes: Array<[string, OcrStatus]> = [];
    q.onChange((id, s) => changes.push([id, s]));
    q.enqueue(a.id);
    q.enqueue(b.id);
    await expect(q.idle()).resolves.toBeUndefined();
    spy.mockRestore();
    expect(changes).toEqual([[a.id, 'failed'], [b.id, 'done']]);
    expect((await store.getPage(a.id))?.ocrStatus).toBe('failed');
    expect((await store.getPage(b.id))?.ocrStatus).toBe('done');
    // queue still usable afterwards
    q.enqueue(a.id);
    await q.idle();
    expect((await store.getPage(a.id))?.ocrStatus).toBe('done');
    warn.mockRestore();
  });

  it('result write rejecting fails that item, continues, idle resolves', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const b = await store.addPage(docId, mkPage('b'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = store.updatePageIfRev;
    const spy = vi.spyOn(store, 'updatePageIfRev').mockImplementation(async (id, rev, patch) => {
      if (id === a.id && patch.ocrStatus === 'done') throw new Error('write failed');
      return real(id, rev, patch);
    });
    const q = createOcrQueue(async (blob) => result(await blob.text()));
    const changes: Array<[string, OcrStatus]> = [];
    q.onChange((id, s) => changes.push([id, s]));
    q.enqueue(a.id);
    q.enqueue(b.id);
    await expect(q.idle()).resolves.toBeUndefined();
    spy.mockRestore();
    expect(changes).toEqual([[a.id, 'failed'], [b.id, 'done']]);
    expect((await store.getPage(a.id))?.ocrStatus).toBe('failed');
    warn.mockRestore();
  });

  it('a throwing listener does not stall the queue', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const b = await store.addPage(docId, mkPage('b'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const q = createOcrQueue(async (blob) => result(await blob.text()));
    q.onChange(() => { throw new Error('bad listener'); });
    q.enqueue(a.id);
    q.enqueue(b.id);
    await q.idle();
    expect((await store.getPage(a.id))?.ocrStatus).toBe('done');
    expect((await store.getPage(b.id))?.ocrStatus).toBe('done');
    warn.mockRestore();
  });

  it('enqueue of the in-flight id queues one more run; duplicates while waiting are no-ops', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const resolvers: Array<() => void> = [];
    const recognize = vi.fn(async (blob: Blob) => {
      await new Promise<void>((r) => resolvers.push(r));
      return result(await blob.text());
    });
    const q = createOcrQueue(recognize);
    q.enqueue(a.id);
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    q.enqueue(a.id);
    q.enqueue(a.id); // already waiting -> no-op
    resolvers[0]();
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    resolvers[1]();
    await q.idle();
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it('enqueue after completion runs again', async () => {
    const a = await store.addPage(docId, mkPage('a'));
    const recognize = vi.fn(async () => result('a'));
    const q = createOcrQueue(recognize);
    q.enqueue(a.id);
    await q.idle();
    q.enqueue(a.id);
    await q.idle();
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it('reprocess during an in-flight run: stale result is dropped, the second run lands', async () => {
    const a = await store.addPage(docId, mkPage('old'));
    const resolvers: Array<() => void> = [];
    const recognize = vi.fn(async (blob: Blob) => {
      const tag = await blob.text();
      await new Promise<void>((r) => resolvers.push(r));
      return result(tag);
    });
    const q = createOcrQueue(recognize);
    const changes: Array<[string, OcrStatus]> = [];
    q.onChange((id, s) => changes.push([id, s]));
    q.enqueue(a.id);
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    // what reprocessPage does: new image, OCR reset, rev bumped, re-enqueued
    await store.updatePage(
      a.id,
      { processedBlob: new Blob(['new'], { type: 'image/jpeg' }), ocrStatus: 'pending', ocr: undefined },
      { bumpRev: true },
    );
    q.enqueue(a.id);
    resolvers[0](); // the stale (rev 0) result arrives
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    const mid = (await store.getPage(a.id))!;
    expect(mid.ocrStatus).toBe('pending');
    expect(mid.ocr).toBeUndefined();
    expect(changes).toEqual([]);
    resolvers[1]();
    await q.idle();
    const end = (await store.getPage(a.id))!;
    expect(end.ocrStatus).toBe('done');
    expect(end.ocr?.words[0].text).toBe('new');
    expect(changes).toEqual([[a.id, 'done']]);
  });

  it('a stale failure does not mark the reprocessed page failed', async () => {
    const a = await store.addPage(docId, mkPage('old'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let reject!: (e: Error) => void;
    const recognize = vi.fn()
      .mockImplementationOnce(() => new Promise<OcrResult>((_, rj) => { reject = rj; }))
      .mockImplementationOnce(async (blob: Blob) => result(await blob.text()));
    const q = createOcrQueue(recognize);
    q.enqueue(a.id);
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    await store.updatePage(a.id, { processedBlob: new Blob(['new']), ocrStatus: 'pending' }, { bumpRev: true });
    q.enqueue(a.id);
    reject(new Error('boom'));
    await q.idle();
    const end = (await store.getPage(a.id))!;
    expect(end.ocrStatus).toBe('done');
    expect(end.ocr?.words[0].text).toBe('new');
    warn.mockRestore();
  });
});
