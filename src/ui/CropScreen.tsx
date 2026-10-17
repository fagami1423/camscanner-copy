import { useState } from 'preact/hooks';
import { enqueueOcr } from '../ocr/resume';
import { reprocessPage } from '../pages/savePage';
import type { Quad } from '../types';
import { CropEditor } from './CropEditor';
import { sameQuad } from './cropMath';
import { reportError } from './errors';
import { usePage } from './usePage';

export function CropScreen(props: { pageId: string; onApplied: () => void; onCancel: (docId: string) => void }) {
  const page = usePage(props.pageId);
  const [busy, setBusy] = useState(false);

  const apply = async (quad: Quad) => {
    // Nothing moved: keep the processed image (and any finished OCR) instead of re-running the pipeline.
    if (page && sameQuad(quad, page.quad)) return props.onApplied();
    setBusy(true);
    try {
      await reprocessPage(props.pageId, { quad }, undefined, { enqueue: enqueueOcr });
      props.onApplied();
    } catch (e) {
      reportError(e, 'Could not apply crop');
      setBusy(false);
    }
  };

  return (
    <div class="screen">
      <header class="bar">
        <h1>Crop</h1>
      </header>
      <main class="content content-center">
        {page && !busy && <CropEditor page={page} onDone={(q) => void apply(q)} onCancel={() => props.onCancel(page.docId)} />}
        {busy && (
          <p class="busy" role="status">
            Processing…
          </p>
        )}
      </main>
    </div>
  );
}
