import { useState } from 'preact/hooks';
import { enqueueOcr } from '../ocr/resume';
import { reprocessPage } from '../pages/savePage';
import type { FilterMode } from '../types';
import { reportError } from './errors';
import { FilterPicker } from './FilterPicker';
import { usePage } from './usePage';

export function FilterScreen(props: { pageId: string; onDone: (docId: string) => void }) {
  const page = usePage(props.pageId);
  const [busy, setBusy] = useState(false);

  const choose = async (filter: FilterMode) => {
    if (!page) return;
    setBusy(true);
    try {
      if (filter !== page.filter) await reprocessPage(page.id, { filter }, undefined, { enqueue: enqueueOcr });
      props.onDone(page.docId);
    } catch (e) {
      reportError(e, 'Could not apply filter');
      setBusy(false);
    }
  };

  return (
    <div class="screen">
      <header class="bar">
        <button type="button" class="btn" disabled={!page || busy} onClick={() => page && props.onDone(page.docId)}>
          ‹ Done
        </button>
        <h1>Filter</h1>
      </header>
      <main class="content content-center">
        {page && !busy && <FilterPicker page={page} onDone={(f) => void choose(f)} />}
        {busy && (
          <p class="busy" role="status">
            Processing…
          </p>
        )}
      </main>
    </div>
  );
}
