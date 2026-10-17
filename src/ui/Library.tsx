import { useEffect, useState } from 'preact/hooks';
import { createDocument, deleteDocument, getPage, listDocuments, renameDocument } from '../store/store';
import type { Document } from '../types';
import { reportError } from './errors';
import { Thumb } from './Thumb';

interface Entry { doc: Document; thumb?: Blob }

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function Library(props: { onOpen: (docId: string) => void; onScan: (docId: string) => void; onSettings: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = async () => {
    try {
      const docs = await listDocuments();
      const withThumbs = await Promise.all(
        docs.map(async (doc) => ({ doc, thumb: doc.pageIds[0] ? (await getPage(doc.pageIds[0]))?.thumbBlob : undefined })),
      );
      setEntries(withThumbs);
    } catch (e) {
      reportError(e, 'Could not load your scans');
      setEntries([]);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const newScan = async () => {
    try {
      const doc = await createDocument();
      props.onScan(doc.id);
    } catch (e) {
      reportError(e, 'Could not create a document');
    }
  };

  const rename = async (doc: Document, name: string) => {
    setEditing(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === doc.name) return;
    try {
      await renameDocument(doc.id, trimmed);
      await load();
    } catch (e) {
      reportError(e, 'Could not rename');
    }
  };

  const remove = async (doc: Document) => {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    try {
      await deleteDocument(doc.id);
      await load();
    } catch (e) {
      reportError(e, 'Could not delete');
    }
  };

  return (
    <div class="screen">
      <header class="bar">
        <h1>Scans</h1>
        <button type="button" class="btn" onClick={props.onSettings}>
          Settings
        </button>
      </header>
      <main class="content">
        {entries && entries.length === 0 && <p class="empty">No scans yet. Tap “New scan” to start.</p>}
        <ul class="doc-grid">
          {entries?.map(({ doc, thumb }) => (
            <li key={doc.id} class="doc-card">
              <button type="button" class="doc-open" aria-label={`Open ${doc.name}`} onClick={() => props.onOpen(doc.id)}>
                <Thumb blob={thumb} alt="" />
              </button>
              {editing === doc.id ? (
                <input
                  class="doc-name-input"
                  aria-label="Document name"
                  defaultValue={doc.name}
                  ref={(el) => el?.focus()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur(); // onBlur saves
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={(e) => void rename(doc, e.currentTarget.value)}
                />
              ) : (
                <div class="doc-name">{doc.name}</div>
              )}
              <div class="doc-meta">
                {doc.pageIds.length} {doc.pageIds.length === 1 ? 'page' : 'pages'} · {fmtDate(doc.updatedAt)}
              </div>
              <div class="doc-actions">
                <button type="button" class="btn btn-small" onClick={() => setEditing(doc.id)}>
                  Rename
                </button>
                <button type="button" class="btn btn-small btn-danger" onClick={() => void remove(doc)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </main>
      <footer class="bar bar-bottom">
        <button type="button" class="btn btn-primary btn-wide" onClick={() => void newScan()}>
          New scan
        </button>
      </footer>
    </div>
  );
}
