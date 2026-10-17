/** Shown while some pages are still waiting for OCR before a PDF export. */
export function ExportDialog(props: { done: number; total: number; onWithoutText: () => void; onCancel: () => void }) {
  return (
    <div class="dialog-backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="export-wait-title">
        <h2 id="export-wait-title">Waiting for text recognition…</h2>
        <progress value={props.done} max={props.total} aria-label="Text recognition progress" />
        <p>
          {props.done} of {props.total} pages ready
        </p>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" class="btn btn-primary" onClick={props.onWithoutText}>
            Export without text
          </button>
        </div>
      </div>
    </div>
  );
}
