import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Document, Page, Settings } from '../types';

interface ScannerDB extends DBSchema {
  documents: { key: string; value: Document };
  pages: { key: string; value: Page; indexes: { byDoc: string } };
  settings: { key: string; value: Settings };
}

const DB_NAME = 'scanner';
const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS: Settings = { pageSize: 'A4', autoCapture: true };

let dbPromise: Promise<IDBPDatabase<ScannerDB>> | null = null;

function db(): Promise<IDBPDatabase<ScannerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ScannerDB>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore('documents', { keyPath: 'id' });
        const pages = d.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('byDoc', 'docId');
        d.createObjectStore('settings');
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

const pad = (n: number) => String(n).padStart(2, '0');

function defaultName(): string {
  const d = new Date();
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function createDocument(name?: string): Promise<Document> {
  const now = Date.now();
  const doc: Document = {
    id: crypto.randomUUID(),
    name: name ?? defaultName(),
    createdAt: now,
    updatedAt: now,
    pageIds: [],
  };
  await (await db()).put('documents', doc);
  return doc;
}

export async function listDocuments(): Promise<Document[]> {
  const all = await (await db()).getAll('documents');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDocument(id: string): Promise<Document | undefined> {
  return (await db()).get('documents', id);
}

export async function renameDocument(id: string, name: string): Promise<Document> {
  const tx = (await db()).transaction('documents', 'readwrite');
  const doc = await tx.store.get(id);
  if (!doc) throw new Error(`Document not found: ${id}`);
  const next = { ...doc, name, updatedAt: Date.now() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function deleteDocument(id: string): Promise<void> {
  const tx = (await db()).transaction(['documents', 'pages'], 'readwrite');
  const keys = await tx.objectStore('pages').index('byDoc').getAllKeys(id);
  await Promise.all([
    ...keys.map((k) => tx.objectStore('pages').delete(k)),
    tx.objectStore('documents').delete(id),
    tx.done,
  ]);
}

/** Deletes the document only if it has no pages (one transaction). Returns whether it was deleted. */
export async function deleteDocumentIfEmpty(id: string): Promise<boolean> {
  const tx = (await db()).transaction(['documents', 'pages'], 'readwrite');
  const doc = await tx.objectStore('documents').get(id);
  const pageKeys = doc ? await tx.objectStore('pages').index('byDoc').getAllKeys(id) : [];
  if (!doc || doc.pageIds.length > 0 || pageKeys.length > 0) {
    await tx.done;
    return false;
  }
  await Promise.all([tx.objectStore('documents').delete(id), tx.done]);
  return true;
}

export async function addPage(docId: string, p: Omit<Page, 'id' | 'docId' | 'rev'>): Promise<Page> {
  const tx = (await db()).transaction(['documents', 'pages'], 'readwrite');
  const doc = await tx.objectStore('documents').get(docId);
  if (!doc) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(`Document not found: ${docId}`);
  }
  const page: Page = { ...p, id: crypto.randomUUID(), docId, rev: 0 };
  await Promise.all([
    tx.objectStore('pages').put(page),
    tx.objectStore('documents').put({ ...doc, pageIds: [...doc.pageIds, page.id], updatedAt: Date.now() }),
    tx.done,
  ]);
  return page;
}

export async function getPage(id: string): Promise<Page | undefined> {
  return (await db()).get('pages', id);
}

/** Stored rev of a page; records written before `rev` existed count as 0. */
const revOf = (p: Page): number => p.rev ?? 0;

/**
 * Patches a page. `bumpRev` increments its rev inside the same transaction (use it whenever
 * processedBlob is regenerated, so in-flight OCR of the previous image is discarded).
 */
export async function updatePage(
  id: string,
  patch: Partial<Omit<Page, 'rev'>>,
  opts: { bumpRev?: boolean } = {},
): Promise<Page> {
  const tx = (await db()).transaction(['documents', 'pages'], 'readwrite');
  const page = await tx.objectStore('pages').get(id);
  if (!page) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(`Page not found: ${id}`);
  }
  const rev = revOf(page) + (opts.bumpRev ? 1 : 0);
  const next: Page = { ...page, ...patch, id: page.id, docId: page.docId, rev };
  const doc = await tx.objectStore('documents').get(page.docId);
  const writes: Promise<unknown>[] = [tx.objectStore('pages').put(next), tx.done];
  if (doc) writes.push(tx.objectStore('documents').put({ ...doc, updatedAt: Date.now() }));
  await Promise.all(writes);
  return next;
}

/**
 * Applies `patch` only if the page still has rev `rev`; the check and the write share one
 * transaction. Returns false (no write) if the page is gone or its rev has moved on.
 */
export async function updatePageIfRev(id: string, rev: number, patch: Partial<Omit<Page, 'rev'>>): Promise<boolean> {
  const tx = (await db()).transaction(['documents', 'pages'], 'readwrite');
  const page = await tx.objectStore('pages').get(id);
  if (!page || revOf(page) !== rev) {
    await tx.done;
    return false;
  }
  const next: Page = { ...page, ...patch, id: page.id, docId: page.docId, rev: revOf(page) };
  const doc = await tx.objectStore('documents').get(page.docId);
  const writes: Promise<unknown>[] = [tx.objectStore('pages').put(next), tx.done];
  if (doc) writes.push(tx.objectStore('documents').put({ ...doc, updatedAt: Date.now() }));
  await Promise.all(writes);
  return true;
}

export async function deletePage(id: string): Promise<void> {
  const tx = (await db()).transaction(['documents', 'pages'], 'readwrite');
  const page = await tx.objectStore('pages').get(id);
  if (!page) {
    await tx.done;
    return;
  }
  const doc = await tx.objectStore('documents').get(page.docId);
  const writes: Promise<unknown>[] = [tx.objectStore('pages').delete(id), tx.done];
  if (doc) {
    writes.push(
      tx.objectStore('documents').put({ ...doc, pageIds: doc.pageIds.filter((x) => x !== id), updatedAt: Date.now() }),
    );
  }
  await Promise.all(writes);
}

export async function reorderPages(docId: string, pageIds: string[]): Promise<void> {
  const tx = (await db()).transaction('documents', 'readwrite');
  const doc = await tx.store.get(docId);
  if (!doc) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(`Document not found: ${docId}`);
  }
  const valid =
    pageIds.length === doc.pageIds.length &&
    new Set(pageIds).size === pageIds.length &&
    pageIds.every((x) => doc.pageIds.includes(x));
  if (!valid) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error("pageIds must be a permutation of the document's pages");
  }
  await Promise.all([tx.store.put({ ...doc, pageIds: [...pageIds], updatedAt: Date.now() }), tx.done]);
}

export async function getSettings(): Promise<Settings> {
  const s = await (await db()).get('settings', SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put('settings', s, SETTINGS_KEY);
}

let persistRequested = false;

export async function requestPersist(): Promise<void> {
  if (persistRequested) return;
  persistRequested = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* never throws */
  }
}

/** Test-only helpers. */
export async function _resetForTests(): Promise<void> {
  if (dbPromise) {
    (await dbPromise.catch(() => null))?.close();
    dbPromise = null;
  }
  await deleteDB(DB_NAME);
}
/** Writes a page record verbatim (e.g. a legacy record without `rev`). */
export async function _putRawPageForTests(p: Page): Promise<void> {
  await (await db()).put('pages', p);
}
export function _resetPersistForTests(): void {
  persistRequested = false;
}
