import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { exportJpegs, exportPdf } from '../export';
import { ocrQueue } from '../ocr/queue';
import { resumePendingOcr } from '../ocr/resume';
import { toExportPages } from '../pages/exportDoc';
import { deletePage, getDocument, getPage, getSettings, reorderPages } from '../store/store';
import type { Document, Page } from '../types';
import { reportError } from './errors';
import { ExportDialog } from './ExportDialog';
import { moveItem } from './moveItem';
import { PageTile } from './PageTile';
import { toast } from './Toast';

const fileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'scan';

export function DocumentView(props: {
  docId: string;
  onBack: () => void;
  onAddPages: () => void;
  onOpenPage: (pageId: string) => void;
}) {
  const { docId } = props;
  const [doc, setDoc] = useState<Document | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const d = await getDocument(docId);
      if (!d) return props.onBack();
      const ps = (await Promise.all(d.pageIds.map((id) => getPage(id)))).filter((p): p is Page => !!p);
      setDoc(d);
      setPages(ps);
      resumePendingOcr(ps);
    } catch (e) {
      reportError(e, 'Could not load document');
    }
  };

  useEffect(() => {
    void load();
    return ocrQueue.onChange((id) => {
      void getPage(id).then((p) => p && setPages((ps) => ps.map((x) => (x.id === id ? p : x))));
    });
  }, [docId]);

  const pending = pages.filter((p) => p.ocrStatus === 'pending').length;

  const commitOrder = async (order: Page[]) => {
    setPages(order);
    try {
      await reorderPages(docId, order.map((p) => p.id));
    } catch (e) {
      reportError(e, 'Could not reorder pages');
      void load();
    }
  };

  const runPdfExport = async (withText: boolean) => {
    setWaiting(false);
    setBusy(true);
    try {
      const [{ buildPdf }, settings] = await Promise.all([import('../pdf/pdf'), getSettings()]);
      const bytes = await buildPdf(await toExportPages(pages, { withText }), { pageSize: settings.pageSize });
      await exportPdf(bytes, fileName(doc?.name ?? 'scan'));
    } catch (e) {
      reportError(e, 'PDF export failed');
    } finally {
      setBusy(false);
    }
  };

  // Once the last pending page finishes OCR while the wait dialog is open, export with text.
  useEffect(() => {
    if (waiting && pending === 0) void runPdfExport(true);
  }, [waiting, pending]);

  const onExportPdf = () => (pending > 0 ? setWaiting(true) : void runPdfExport(true));

  const onExportJpegs = async () => {
    setBusy(true);
    try {
      await exportJpegs(pages.map((p) => p.processedBlob), fileName(doc?.name ?? 'scan'));
    } catch (e) {
      reportError(e, 'JPEG export failed');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (page: Page, n: number) => {
    if (!confirm(`Delete page ${n}?`)) return;
    try {
      await deletePage(page.id);
      await load();
      toast('Page deleted');
    } catch (e) {
      reportError(e, 'Could not delete page');
    }
  };

  const handleFor = (i: number) => ({
    onPointerDown: (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from: i, over: i });
    },
    onPointerMove: (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
      if (!drag) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-index]');
      const over = el ? Number(el.dataset.index) : NaN;
      if (Number.isInteger(over) && over !== drag.over) setDrag({ ...drag, over });
    },
    onPointerUp: () => {
      if (drag && drag.over !== drag.from) void commitOrder(moveItem(pages, drag.from, drag.over));
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
      const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (!delta) return;
      e.preventDefault();
      const to = i + delta;
      if (to >= 0 && to < pages.length) void commitOrder(moveItem(pages, i, to));
    },
  });

  return (
    <div class="screen">
      <header class="bar">
        <button type="button" class="btn" onClick={props.onBack}>
          ‹ Scans
        </button>
        <h1 class="doc-title">{doc?.name ?? ''}</h1>
      </header>
      <main class="content">
        {doc && pages.length === 0 && <p class="empty">No pages yet. Tap “Add pages”.</p>}
        <ol class="page-grid">
          {pages.map((p, i) => (
            <PageTile
              key={p.id}
              page={p}
              index={i}
              dragging={drag?.from === i}
              dropTarget={!!drag && drag.over === i && drag.from !== i}
              onOpen={() => props.onOpenPage(p.id)}
              onDelete={() => void onDelete(p, i + 1)}
              handle={handleFor(i)}
            />
          ))}
        </ol>
      </main>
      <footer class="bar bar-bottom">
        <button type="button" class="btn" onClick={props.onAddPages}>
          Add pages
        </button>
        <button type="button" class="btn btn-primary" disabled={busy || pages.length === 0} onClick={onExportPdf}>
          Export PDF
        </button>
        <button type="button" class="btn" disabled={busy || pages.length === 0} onClick={() => void onExportJpegs()}>
          Export JPEGs
        </button>
      </footer>
      {waiting && (
        <ExportDialog
          done={pages.length - pending}
          total={pages.length}
          onWithoutText={() => void runPdfExport(false)}
          onCancel={() => setWaiting(false)}
        />
      )}
    </div>
  );
}
