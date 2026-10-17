import { useEffect, useRef, useState } from 'preact/hooks';
import { startAutoCapture } from '../camera/autocapture';
import { Camera, CameraError } from '../camera/camera';
import { createCaptureQueue } from '../camera/captureQueue';
import type { CaptureQueue } from '../camera/captureQueue';
import { createShotTracker } from '../camera/shotTracker';
import type { ShotTracker } from '../camera/shotTracker';
import { getCv, onCvProgress } from '../cv/client';
import type { CvState } from '../cv/client';
import { liveQuadForStill } from '../cv/geometry';
import { enqueueOcr } from '../ocr/resume';
import { savePage, saveRawPage } from '../pages/savePage';
import { deleteDocumentIfEmpty, getDocument, getSettings, requestPersist } from '../store/store';
import type { Quad } from '../types';
import { reportError } from './errors';
import { containTransform, quadToDisplay } from './overlayMath';
import { toast } from './Toast';

const DETECT_MAX = 480;

/** A capture plus the live outline at shutter time (full-res video coords), used if still detection fails. */
interface Capture {
  blob: Blob;
  live?: { quad: Quad; videoW: number; videoH: number };
}

function cameraMessage(err: CameraError): string {
  if (err.kind === 'insecure') return 'You can still import photos from your gallery.';
  if (err.kind === 'denied') return 'Camera access was denied. You can still import photos from your gallery.';
  return 'No camera available. You can still import photos from your gallery.';
}

/** `empty`: the document has no pages (it is deleted when the camera closes). */
export function CameraScreen(props: {
  docId: string;
  onDone: (empty: boolean) => void;
  onCancel: (empty: boolean) => void;
}) {
  const { docId } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<Camera>(new Camera());
  const cvStateRef = useRef<CvState>('loading');
  const autoRef = useRef(true);
  const aliveRef = useRef(true);
  const leavingRef = useRef(false);
  /** Runs once the camera has closed and no capture is left to save. */
  const settleRef = useRef<() => void>(() => {});
  // A shot still waiting on the camera isn't queued yet; leaving must wait for it, or the
  // empty-document cleanup could delete the document the photo is about to be saved into.
  const shotRef = useRef<ShotTracker | null>(null);
  if (!shotRef.current) shotRef.current = createShotTracker(() => !aliveRef.current && settleRef.current());

  const [camError, setCamError] = useState<CameraError | null>(null);
  const [cv, setCv] = useState<{ state: CvState; error?: string }>({ state: 'loading' });
  const [auto, setAuto] = useState(true);
  const [count, setCount] = useState(0);
  const [queued, setQueued] = useState(0);
  const [flash, setFlash] = useState(false);

  const liveQuadRef = useRef<Quad | null>(null);

  const queueRef = useRef<CaptureQueue<Capture> | null>(null);
  if (!queueRef.current) {
    queueRef.current = createCaptureQueue<Capture>({
      saveProcessed: async ({ blob, live }) => {
        const fallbackQuad = live
          ? (w: number, h: number) => liveQuadForStill(live.quad, live.videoW, live.videoH, w, h)
          : undefined;
        await savePage(docId, blob, { enqueue: enqueueOcr, fallbackQuad });
      },
      saveRaw: async ({ blob }) => void (await saveRawPage(docId, blob, { enqueue: enqueueOcr })),
      onSaved: () => {
        void requestPersist();
        if (aliveRef.current) setCount((c) => c + 1);
      },
      onPending: (n) => {
        if (aliveRef.current) setQueued(n);
        else settleRef.current(); // closed while captures were still saving
      },
      onSaveError: (e) => reportError(e, 'Could not save page'),
      notify: (msg) => toast(msg, 'error'),
    });
  }
  const enqueue = (items: Capture[]) => queueRef.current!.push(items);

  const drawQuad = (q: Quad | null) => {
    liveQuadRef.current = q;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr)) canvas.width = Math.round(cw * dpr);
    if (canvas.height !== Math.round(ch * dpr)) canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!q) return;
    const pts = quadToDisplay(q, containTransform(video.videoWidth, video.videoHeight, cw, ch));
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(10,132,255,0.2)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0a84ff';
    ctx.stroke();
  };

  const shoot = () => {
    if (cvStateRef.current === 'error' || leavingRef.current) return;
    shotRef.current!.run(async () => {
      try {
        const video = videoRef.current;
        const quad = liveQuadRef.current;
        const live = quad && video?.videoWidth ? { quad, videoW: video.videoWidth, videoH: video.videoHeight } : undefined;
        const blob = await camRef.current.capture();
        if (aliveRef.current) {
          setFlash(true);
          setTimeout(() => aliveRef.current && setFlash(false), 150);
        }
        enqueue([{ blob, live }]);
      } catch (e) {
        reportError(e, 'Capture failed');
      }
    });
  };

  useEffect(() => {
    aliveRef.current = true;
    getSettings().then(
      (s) => {
        autoRef.current = s.autoCapture;
        if (aliveRef.current) setAuto(s.autoCapture);
      },
      () => {},
    );
    getDocument(docId).then(
      (d) => d && aliveRef.current && setCount(d.pageIds.length),
      () => {},
    );
    getCv(); // starts loading the CV worker
    const unsubCv = onCvProgress((state, error) => {
      cvStateRef.current = state;
      if (aliveRef.current) setCv({ state, error });
      queueRef.current!.setCvState(state);
    });
    // After the screen closes (Done, Cancel or system Back) captures still queued keep saving, so the
    // CV subscription stays until the queue is empty; then a document left without pages is deleted.
    let settled = false;
    settleRef.current = () => {
      if (settled || aliveRef.current || shotRef.current!.busy() || queueRef.current!.pending() > 0) return;
      settled = true;
      unsubCv();
      deleteDocumentIfEmpty(docId).catch((e) => console.warn('empty document cleanup failed', e));
    };

    const cam = camRef.current;
    let stopped = false;
    const start = async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        await cam.start(video);
        if (stopped || document.hidden) cam.stop();
        else setCamError(null);
      } catch (e) {
        if (!stopped) setCamError(e instanceof CameraError ? e : new CameraError('unavailable', String(e)));
      }
    };
    void start();
    const onVisibility = () => {
      if (document.hidden) cam.stop();
      else if (!stopped) void start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const stopAuto = startAutoCapture({
      sample: () => cam.sampleFrame(DETECT_MAX),
      detect: (img) => (cvStateRef.current === 'ready' ? getCv().detect(img) : Promise.resolve(null)),
      onQuad: drawQuad,
      onFire: shoot,
      enabled: () => autoRef.current && cvStateRef.current === 'ready',
    });

    return () => {
      stopped = true;
      aliveRef.current = false;
      stopAuto();
      settleRef.current();
      document.removeEventListener('visibilitychange', onVisibility);
      cam.stop();
    };
  }, [docId]);

  /** True (after deleting it) if the document ended up with no pages, so the caller skips its screen. */
  const dropIfEmpty = async (): Promise<boolean> => {
    if (queueRef.current!.pending() > 0) return false;
    return deleteDocumentIfEmpty(docId).catch((e) => {
      console.warn('empty document cleanup failed', e);
      return false;
    });
  };

  const cancel = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true; // no new shots while deciding
    await shotRef.current!.idle(); // a photo being taken joins the queue before it's counted
    const q = queueRef.current!;
    const n = q.pending();
    if (n > 0 && !window.confirm(`Discard ${n} unsaved capture(s)?`)) {
      leavingRef.current = false;
      return;
    }
    q.discard();
    await q.idle(); // a capture already being saved finishes
    props.onCancel(await dropIfEmpty());
  };

  const done = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    await shotRef.current!.idle(); // its page must exist before the document is judged empty
    props.onDone(await dropIfEmpty());
  };

  const cvBroken = cv.state === 'error';
  const noCamera = camError !== null;
  const busy = queued > 0 && !cvBroken;

  return (
    <div class="screen camera-screen">
      {camError?.kind === 'insecure' && (
        <div class="banner banner-error" role="alert">
          Camera requires HTTPS
        </div>
      )}
      {cv.state === 'loading' && (
        <div class="banner" role="status">
          Loading scanner…
        </div>
      )}
      {cvBroken && (
        <div class="banner banner-error" role="alert">
          Scanner engine failed to load{cv.error ? `: ${cv.error}` : ''}
        </div>
      )}
      <div class="viewfinder">
        <video ref={videoRef} class="camera-video" playsInline muted autoPlay aria-label="Camera preview" />
        <canvas ref={canvasRef} class="camera-overlay" aria-hidden="true" />
        {flash && <div class="camera-flash" aria-hidden="true" />}
        {noCamera && (
          <div class="camera-message">
            <p>{cameraMessage(camError)}</p>
            <button type="button" class="btn btn-primary" disabled={cvBroken} onClick={() => fileRef.current?.click()}>
              Import from gallery
            </button>
          </div>
        )}
      </div>
      <div class="camera-controls">
        <button type="button" class="btn" onClick={() => void cancel()}>
          Cancel
        </button>
        <label class="toggle">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              autoRef.current = e.currentTarget.checked;
              setAuto(e.currentTarget.checked);
            }}
          />
          <span>Auto</span>
        </label>
        <button type="button" class="btn" disabled={cvBroken} onClick={() => fileRef.current?.click()}>
          Gallery
        </button>
        <button type="button" class="shutter" aria-label="Capture page" disabled={noCamera || cvBroken} onClick={shoot} />
        <span class="page-count" aria-live="polite">
          {count} {count === 1 ? 'page' : 'pages'}
          {queued > 0 && ` (+${queued} saving)`}
        </span>
        <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void done()}>
          {busy ? 'Saving…' : 'Done'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Import images"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          enqueue(files.map((blob) => ({ blob })));
        }}
      />
    </div>
  );
}
