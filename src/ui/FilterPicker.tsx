import { useEffect, useState } from 'preact/hooks';
import { getCv } from '../cv/client';
import { scaleQuad } from '../cv/geometry';
import { imageDataFromBitmap, imageDataToBlob, loadBitmap } from '../image';
import type { FilterMode, Page } from '../types';

const MODES: { mode: FilterMode; label: string }[] = [
  { mode: 'original', label: 'Original' },
  { mode: 'magic', label: 'Magic' },
  { mode: 'gray', label: 'Gray' },
  { mode: 'bw', label: 'B&W' },
];

/** Draws a fresh copy of the pixels (ImageData handed to the CV worker is transferred). */
function copy(img: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

export function FilterPicker(props: { page: Page; onDone: (f: FilterMode) => void }) {
  const { page } = props;
  const [urls, setUrls] = useState<Partial<Record<FilterMode, string>>>({});

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    (async () => {
      const bitmap = await loadBitmap(page.originalBlob);
      try {
        const base = imageDataFromBitmap(bitmap, 400);
        const quad = scaleQuad(page.quad, base.width / bitmap.width);
        const cv = getCv();
        const warped = await cv.warp(copy(base), quad);
        for (const { mode } of MODES) {
          const out = await cv.enhance(copy(warped), mode);
          const url = URL.createObjectURL(await imageDataToBlob(out));
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          made.push(url);
          setUrls((u) => ({ ...u, [mode]: url }));
        }
      } finally {
        bitmap.close();
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [page.originalBlob, page.quad]);

  return (
    <div class="filter-picker" role="radiogroup" aria-label="Filter">
      {MODES.map(({ mode, label }) => (
        <button
          type="button"
          key={mode}
          role="radio"
          aria-checked={page.filter === mode}
          aria-label={`${label} filter`}
          onClick={() => props.onDone(mode)}
          style={{ outline: page.filter === mode ? '3px solid #0a84ff' : 'none' }}
        >
          {urls[mode] ? <img src={urls[mode]} alt={`${label} preview`} style={{ maxWidth: 120 }} /> : <span>…</span>}
          <div>{label}</div>
        </button>
      ))}
    </div>
  );
}
