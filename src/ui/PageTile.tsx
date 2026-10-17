import type { JSX } from 'preact';
import type { OcrStatus, Page } from '../types';
import { Thumb } from './Thumb';

const OCR_LABEL: Record<OcrStatus, string> = { pending: 'Reading text…', done: 'Text', failed: 'No text' };

export interface PageTileProps {
  page: Page;
  index: number;
  dragging: boolean;
  dropTarget: boolean;
  onOpen: () => void;
  onDelete: () => void;
  handle: {
    onPointerDown: (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: () => void;
    onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => void;
  };
}

export function PageTile(props: PageTileProps) {
  const { page, index } = props;
  const n = index + 1;
  const cls = ['page-tile', props.dragging && 'dragging', props.dropTarget && 'drop-target'].filter(Boolean).join(' ');
  return (
    <li class={cls} data-index={index} data-page-id={page.id}>
      <button type="button" class="page-open" aria-label={`Edit page ${n}`} onClick={props.onOpen}>
        <Thumb blob={page.thumbBlob} alt={`Page ${n}`} />
      </button>
      <div class="page-row">
        <span class="page-num">{n}</span>
        <span class={`ocr-badge ocr-${page.ocrStatus}`} data-ocr={page.ocrStatus}>
          {OCR_LABEL[page.ocrStatus]}
        </span>
      </div>
      <div class="page-row">
        <button type="button" class="drag-handle" aria-label={`Reorder page ${n} (drag, or use arrow keys)`} {...props.handle}>
          ⠿
        </button>
        <button type="button" class="btn btn-small btn-danger" aria-label={`Delete page ${n}`} onClick={props.onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
