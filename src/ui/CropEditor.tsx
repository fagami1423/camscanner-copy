import { useEffect, useRef, useState } from 'preact/hooks';
import { getCv } from '../cv/client';
import { fullFrameQuad, isValidQuad } from '../cv/geometry';
import { imageDataFromBitmap, loadBitmap } from '../image';
import type { Page, Point, Quad } from '../types';
import { displayToImage, dragTarget, grabOffset, imageToDisplay, loupeSourceRect, moveHandle } from './cropMath';
import type { Size } from './cropMath';

const LOUPE = 120;
const ZOOM = 2;
const LABELS = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
const HIT_R = 24; // touch target (48 px across), transparent
const DOT_R = 12; // visible handle

export function CropEditor(props: { page: Page; onDone: (q: Quad) => void; onCancel: () => void }) {
  const { page } = props;
  const imgRef = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState('');
  const [quad, setQuad] = useState<Quad>(page.quad);
  const [natural, setNatural] = useState<Size | null>(null);
  const [shown, setShown] = useState<Size | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const grabRef = useRef<Point>({ x: 0, y: 0 }); // handle minus pointer at pointerdown (display px)
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = URL.createObjectURL(page.originalBlob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [page.originalBlob]);

  const measure = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setShown({ w: img.clientWidth, h: img.clientHeight });
  };
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const ready = natural && shown;
  const valid = !!natural && isValidQuad(quad, natural.w, natural.h, 0);

  const pointerAt = (e: PointerEvent): Point | null => {
    if (!imgRef.current) return null;
    const r = imgRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onMove = (i: number, e: PointerEvent) => {
    const at = pointerAt(e);
    if (drag !== i || !natural || !shown || !at) return;
    const p = displayToImage(dragTarget(at, grabRef.current), natural, shown);
    setQuad((q) => moveHandle(q, i, p, natural.w, natural.h));
  };

  const autoDetect = async () => {
    if (!natural) return;
    setBusy(true);
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await loadBitmap(page.originalBlob);
      const small = imageDataFromBitmap(bitmap, 480);
      const f = bitmap.width / small.width;
      const found = await getCv().detect(small);
      if (found) {
        setQuad(moveAll(found, f, natural));
      }
    } finally {
      bitmap?.close();
      setBusy(false);
    }
  };

  const disp = ready ? quad.map((p) => imageToDisplay(p, natural, shown)) : [];
  const loupeAt = drag !== null && disp[drag] ? disp[drag] : null;

  return (
    <div class="crop-editor">
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', touchAction: 'none' }}>
        <img
          ref={imgRef}
          src={url}
          alt="Original page"
          onLoad={measure}
          draggable={false}
          style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh' }}
        />
        {ready && (
          <svg
            width={shown.w}
            height={shown.h}
            style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
            aria-label="Crop outline"
          >
            <polygon
              points={disp.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="rgba(0,120,255,0.15)"
              stroke={valid ? '#0a84ff' : '#ff3b30'}
              stroke-width="2"
            />
            {disp.map((p, i) => (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={DOT_R}
                  fill="#fff"
                  stroke={valid ? '#0a84ff' : '#ff3b30'}
                  stroke-width="3"
                  pointer-events="none"
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={HIT_R}
                  fill="transparent"
                  pointer-events="all"
                  role="slider"
                  aria-label={`${LABELS[i]} corner`}
                  tabIndex={0}
                  style={{ cursor: 'grab', touchAction: 'none' }}
                  onPointerDown={(e) => {
                    const at = pointerAt(e);
                    grabRef.current = at ? grabOffset(p, at) : { x: 0, y: 0 };
                    (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
                    setDrag(i);
                  }}
                  onPointerMove={(e) => onMove(i, e)}
                  onPointerUp={() => setDrag(null)}
                  onPointerCancel={() => setDrag(null)}
                />
              </g>
            ))}
          </svg>
        )}
        {loupeAt && ready && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: LOUPE,
              height: LOUPE,
              borderRadius: '50%',
              border: '2px solid #fff',
              boxShadow: '0 0 6px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
              left: Math.min(Math.max(0, loupeAt.x - LOUPE / 2), Math.max(0, shown.w - LOUPE)),
              top: loupeAt.y - LOUPE - 30 >= 0 ? loupeAt.y - LOUPE - 30 : loupeAt.y + 30,
              backgroundImage: `url(${url})`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${shown.w * ZOOM}px ${shown.h * ZOOM}px`,
              backgroundPosition: (() => {
                const r = loupeSourceRect(loupeAt, LOUPE, ZOOM);
                return `${-r.x * ZOOM}px ${-r.y * ZOOM}px`;
              })(),
            }}
          />
        )}
      </div>
      <div class="crop-actions">
        <button type="button" aria-label="Use full image" disabled={!natural} onClick={() => natural && setQuad(fullFrameQuad(natural.w, natural.h))}>
          Full image
        </button>
        <button type="button" aria-label="Auto-detect edges" disabled={!natural || busy} onClick={autoDetect}>
          Auto-detect
        </button>
        <button type="button" aria-label="Cancel" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" aria-label="Apply crop" disabled={!valid} onClick={() => props.onDone(quad)}>
          Apply
        </button>
      </div>
    </div>
  );
}

function moveAll(found: Quad, f: number, natural: Size): Quad {
  return found.map((p) => ({
    x: Math.min(natural.w, Math.max(0, p.x * f)),
    y: Math.min(natural.h, Math.max(0, p.y * f)),
  })) as Quad;
}
