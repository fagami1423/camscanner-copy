import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as store from '../../src/store/store';
import type { Page } from '../../src/types';

const pt = { x: 0, y: 0 };
const mkPage = (): Omit<Page, 'id' | 'docId' | 'rev'> => ({
  originalBlob: new Blob(['orig'], { type: 'image/jpeg' }),
  quad: [pt, pt, pt, pt],
  filter: 'original',
  processedBlob: new Blob(['proc'], { type: 'image/jpeg' }),
  thumbBlob: new Blob(['thumb'], { type: 'image/jpeg' }),
  ocrStatus: 'pending',
});

let now = 1000;
beforeEach(async () => {
  now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
  await store._resetForTests();
});
afterEach(() => vi.restoreAllMocks());

describe('store', () => {
  it('creates documents with default name and lists updatedAt desc', async () => {
    const a = await store.createDocument();
    expect(a.name).toMatch(/^Scan \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const b = await store.createDocument('B');
    expect(b.name).toBe('B');
    expect((await store.listDocuments()).map((d) => d.id)).toEqual([b.id, a.id]);
    await store.renameDocument(a.id, 'A2');
    expect((await store.listDocuments()).map((d) => d.id)).toEqual([a.id, b.id]);
  });

  it('renames', async () => {
    const d = await store.createDocument();
    const r = await store.renameDocument(d.id, 'New');
    expect(r.name).toBe('New');
    expect((await store.getDocument(d.id))!.name).toBe('New');
    expect(r.updatedAt).toBeGreaterThan(d.updatedAt);
  });

  it('addPage appends and bumps updatedAt, blobs round-trip', async () => {
    const d = await store.createDocument();
    const p1 = await store.addPage(d.id, mkPage());
    const p2 = await store.addPage(d.id, mkPage());
    const got = (await store.getDocument(d.id))!;
    expect(got.pageIds).toEqual([p1.id, p2.id]);
    expect(got.updatedAt).toBeGreaterThan(d.updatedAt);
    const stored = (await store.getPage(p1.id))!;
    expect(stored.docId).toBe(d.id);
    expect(stored.thumbBlob.size).toBe(5);
  });

  it('updatePage patches and bumps parent', async () => {
    const d = await store.createDocument();
    const p = await store.addPage(d.id, mkPage());
    const before = (await store.getDocument(d.id))!.updatedAt;
    const u = await store.updatePage(p.id, { ocrStatus: 'done', id: 'x', docId: 'y' });
    expect(u.ocrStatus).toBe('done');
    expect(u.id).toBe(p.id);
    expect(u.docId).toBe(d.id);
    expect((await store.getDocument(d.id))!.updatedAt).toBeGreaterThan(before);
  });

  it('deleteDocument removes its pages', async () => {
    const d = await store.createDocument();
    const p1 = await store.addPage(d.id, mkPage());
    const p2 = await store.addPage(d.id, mkPage());
    await store.deleteDocument(d.id);
    expect(await store.getDocument(d.id)).toBeUndefined();
    expect(await store.getPage(p1.id)).toBeUndefined();
    expect(await store.getPage(p2.id)).toBeUndefined();
  });

  it('deletePage removes id', async () => {
    const d = await store.createDocument();
    const p1 = await store.addPage(d.id, mkPage());
    const p2 = await store.addPage(d.id, mkPage());
    await store.deletePage(p1.id);
    expect(await store.getPage(p1.id)).toBeUndefined();
    expect((await store.getDocument(d.id))!.pageIds).toEqual([p2.id]);
  });

  it('reorderPages reorders and rejects non-permutations', async () => {
    const d = await store.createDocument();
    const p1 = await store.addPage(d.id, mkPage());
    const p2 = await store.addPage(d.id, mkPage());
    await store.reorderPages(d.id, [p2.id, p1.id]);
    expect((await store.getDocument(d.id))!.pageIds).toEqual([p2.id, p1.id]);
    const msg = "pageIds must be a permutation of the document's pages";
    await expect(store.reorderPages(d.id, [p1.id])).rejects.toThrow(msg);
    await expect(store.reorderPages(d.id, [p1.id, p1.id])).rejects.toThrow(msg);
    await expect(store.reorderPages(d.id, [p1.id, 'zzz'])).rejects.toThrow(msg);
  });

  it('settings default and round-trip', async () => {
    expect(await store.getSettings()).toEqual({ pageSize: 'A4', autoCapture: true });
    await store.saveSettings({ pageSize: 'Letter', autoCapture: false });
    expect(await store.getSettings()).toEqual({ pageSize: 'Letter', autoCapture: false });
  });

  it('requestPersist is safe in Node and calls persist once', async () => {
    await expect(store.requestPersist()).resolves.toBeUndefined();
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist } });
    store._resetPersistForTests();
    await store.requestPersist();
    await store.requestPersist();
    expect(persist).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('page rev (OCR staleness guard)', () => {
  it('addPage starts at rev 0; updatePage with bumpRev increments it', async () => {
    const d = await store.createDocument();
    const p = await store.addPage(d.id, mkPage());
    expect(p.rev).toBe(0);
    const u = await store.updatePage(p.id, { ocrStatus: 'pending' }, { bumpRev: true });
    expect(u.rev).toBe(1);
    expect((await store.getPage(p.id))!.rev).toBe(1);
    expect((await store.updatePage(p.id, { ocrStatus: 'pending' })).rev).toBe(1);
  });

  it('updatePageIfRev writes and returns true only when the stored rev matches', async () => {
    const d = await store.createDocument();
    const p = await store.addPage(d.id, mkPage());
    expect(await store.updatePageIfRev(p.id, 1, { ocrStatus: 'done' })).toBe(false);
    expect((await store.getPage(p.id))!.ocrStatus).toBe('pending');
    expect(await store.updatePageIfRev(p.id, 0, { ocrStatus: 'done' })).toBe(true);
    expect((await store.getPage(p.id))!.ocrStatus).toBe('done');
    expect(await store.updatePageIfRev('missing', 0, { ocrStatus: 'done' })).toBe(false);
  });

  it('a record without rev (pre-rev data) is treated as rev 0', async () => {
    const d = await store.createDocument();
    const p = await store.addPage(d.id, mkPage());
    const legacy = { ...(await store.getPage(p.id))! } as Partial<Page>;
    delete legacy.rev;
    await store._putRawPageForTests(legacy as Page);
    expect(await store.updatePageIfRev(p.id, 1, { ocrStatus: 'done' })).toBe(false);
    expect(await store.updatePageIfRev(p.id, 0, { ocrStatus: 'done' })).toBe(true);
    expect((await store.updatePage(p.id, {}, { bumpRev: true })).rev).toBe(1);
  });
});

describe('deleteDocumentIfEmpty', () => {
  it('deletes a document with zero pages and reports it', async () => {
    const d = await store.createDocument();
    expect(await store.deleteDocumentIfEmpty(d.id)).toBe(true);
    expect(await store.getDocument(d.id)).toBeUndefined();
  });
  it('keeps a document that has pages', async () => {
    const d = await store.createDocument();
    await store.addPage(d.id, mkPage());
    expect(await store.deleteDocumentIfEmpty(d.id)).toBe(false);
    expect(await store.getDocument(d.id)).toBeDefined();
  });
  it('missing document: false', async () => {
    expect(await store.deleteDocumentIfEmpty('nope')).toBe(false);
  });
});
