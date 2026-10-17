# Web Document Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only, offline-capable PWA that scans documents with the phone camera (live edge detection + auto-capture), corrects perspective, enhances, OCRs, stores a document library in IndexedDB, and exports searchable PDFs.

**Architecture:** Preact UI on the main thread; OpenCV.js and Tesseract.js each run in a Web Worker exposed via Comlink. All CV logic lives in pure functions that take a `cv` instance so they are testable in Node. Persistence is IndexedDB via `idb`; PDF via `pdf-lib`. A strict CSP forbids any non-self network traffic.

**Tech Stack:** Node 22, Vite 5, TypeScript 5 (strict), Preact 10, Comlink 4, `@techstark/opencv-js` 4.10, `tesseract.js` 5, `pdf-lib` 1.17, `idb` 8, `vite-plugin-pwa` 0.20, Vitest 2 + `fake-indexeddb` + `pdfjs-dist` (tests), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-10-16-web-doc-scanner-design.md`

## Global Constraints

- No runtime network requests other than same-origin; every library asset is self-hosted (OpenCV bundled by Vite into the CV worker chunk; Tesseract core/worker and `eng.traineddata` under `public/vendor/tesseract/`).
- CSP (in `index.html` meta and dev/preview server headers): `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`.
- No analytics, telemetry, or third-party SDKs.
- Quad corner order everywhere is TL, TR, BR, BL in full-resolution pixel coordinates.
- Live detection input: long side 480 px, ~10 Hz, drop frames while a detection is in flight.
- Quad acceptance: 4 vertices, convex, area ≥ 20% of frame, every interior angle in [45°, 135°].
- Auto-capture: EMA α = 0.5; stable when max corner displacement < 2% of frame diagonal for ≥ 800 ms; 1500 ms cooldown.
- Warp output long side capped at 3000 px; processed JPEG quality 0.9; thumbnails ~256 px long side; PDF image JPEG quality 0.85.
- OCR: language `eng`, PSM 3, one worker, sequential queue.
- PDF page size A4 (595.28×841.89 pt) default or Letter (612×792 pt).
- Detection accuracy target: every corner within 2% of the image diagonal of ground truth.
- TypeScript `strict: true`; no `any` in `src/` except at the OpenCV boundary (`type CV = any` in `src/cv/types.ts`).

## Review Focus

1. **Gallery photo with EXIF rotation** (phone portrait JPEG) — expect it to appear upright, not sideways. Pinned in Task 4 (`loadBitmap` uses `imageOrientation: 'from-image'`) and Task 11 E2E import test.
2. **Very large captures (48 MP phone cameras)** — expect no crash and output capped at 3000 px. Pinned in Task 3 `warp caps long side at 3000`.
3. **Crop handles dragged outside the image or into a twisted/concave shape** — expect corners clamped to the image and Apply disabled for invalid quads. Pinned in Task 2 `clampQuad` / `isValidQuad` tests and Task 9.
4. **Deleting a document** — expect all of its pages and blobs gone (no silent quota leak). Pinned in Task 5 `deleteDocument removes its pages`.
5. **OCR text containing characters Helvetica/WinAnsi can't encode** (`→`, emoji, CJK picked up as noise) — expect export to succeed with those characters dropped. Pinned in Task 7 `strips non-WinAnsi characters`.

---

## File Structure

```
index.html                     CSP meta, root div
vite.config.ts                 Preact, PWA, CSP headers, worker format 'es'
scripts/copy-vendor.mjs        copies OpenCV/Tesseract assets into public/vendor/
src/main.tsx                   mount <App/>
src/app.tsx                    screen router (state machine, no router lib)
src/types.ts                   Point, Quad, FilterMode, OcrWord, OcrResult, Document, Page, Settings
src/cv/types.ts                type CV = any
src/cv/geometry.ts             pure quad math + StabilityTracker
src/cv/detect.ts               detectQuad(cv, imageData)
src/cv/process.ts              warp(cv, ...), enhance(cv, ...)
src/cv/cv.worker.ts            loads OpenCV, exposes CvApi via Comlink
src/cv/client.ts               getCv(): Remote<CvApi>
src/image.ts                   loadBitmap, bitmapToBlob, makeThumb, imageDataFromBitmap
src/store/store.ts             IndexedDB CRUD
src/ocr/ocr.worker.ts          Tesseract wrapper
src/ocr/queue.ts               sequential OCR queue writing results to store
src/pdf/pdf.ts                 buildPdf + text-layer math
src/export.ts                  share-or-download
src/camera/camera.ts           getUserMedia, sampleFrame, capture
src/camera/autocapture.ts      ties sampling → detect → tracker → capture
src/pages/savePage.ts          capture/import → warp → enhance → store → enqueue OCR
src/ui/*.tsx                   Library, CameraScreen, CropEditor, FilterPicker, DocumentView, Settings, Toast
tests/unit/*.test.ts           Vitest
tests/cv/*.test.ts             Vitest, Node, real OpenCV
tests/fixtures/generate.ts     synthetic fixture generator (+ committed outputs)
tests/e2e/*.spec.ts            Playwright
docs/camscanner-research.md    research deliverable
```

Shared types in `src/types.ts` (Task 1 creates them; everyone imports from here):

```ts
export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export type FilterMode = 'original' | 'magic' | 'gray' | 'bw';
export interface OcrWord { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }
export interface OcrResult { words: OcrWord[]; width: number; height: number }
export interface Document { id: string; name: string; createdAt: number; updatedAt: number; pageIds: string[] }
export type OcrStatus = 'pending' | 'done' | 'failed';
export interface Page {
  id: string; docId: string; originalBlob: Blob; quad: Quad; filter: FilterMode;
  processedBlob: Blob; thumbBlob: Blob; ocrStatus: OcrStatus; ocr?: OcrResult;
}
export interface Settings { pageSize: 'A4' | 'Letter'; autoCapture: boolean }
```

---

### Task 1: Project scaffold, CSP, vendor assets

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/app.tsx`, `src/types.ts`, `scripts/copy-vendor.mjs`, `.gitignore`, `vitest.config.ts`, `tests/unit/csp.test.ts`

**Interfaces:**
- Produces: `src/types.ts` (above); `CSP` string exported from `vite.config.ts`'s sibling `csp.ts` (`export const CSP: string`); npm scripts `dev`, `build`, `preview`, `test`, `test:e2e`, `vendor` (vendor runs on `postinstall`).

- [ ] **Step 1: Scaffold** with `npm create vite@5 . -- --template preact-ts`, then install the runtime and dev deps from Tech Stack. Add `public/vendor/` to `.gitignore` (regenerated by `postinstall`).
- [ ] **Step 2: Write failing test** `tests/unit/csp.test.ts`:
  - `CSP` equals the Global Constraints string exactly.
  - `index.html` contains `<meta http-equiv="Content-Security-Policy" content="${CSP}">`.
- [ ] **Step 3: Run** `npx vitest run tests/unit/csp.test.ts` → FAIL (no `csp.ts`).
- [ ] **Step 4: Implement** `csp.ts`; put the meta in `index.html`; in `vite.config.ts` set `server.headers` and `preview.headers` `Content-Security-Policy` to `CSP`, `worker: { format: 'es' }`. `scripts/copy-vendor.mjs` copies Tesseract `worker.min.js` and `tesseract-core-simd-lstm.wasm.js` (+ non-SIMD fallback) → `public/vendor/tesseract/`, and downloads `eng.traineddata.gz` from `tessdata_fast` at install time (only network fetch in the project, build-time only) → `public/vendor/tesseract/lang/`.
- [ ] **Step 5: Run** `npx vitest run` → PASS; `npm run build` → succeeds; `npm run dev` serves a blank app with no CSP violations in the console.
- [ ] **Step 6: Commit** `chore: scaffold Vite+Preact PWA with strict CSP and vendored assets`.

### Task 2: Geometry module

**Files:**
- Create: `src/cv/geometry.ts`
- Test: `tests/unit/geometry.test.ts`

**Interfaces:**
- Produces:
  - `orderCorners(pts: Point[]): Quad` — TL = min(x+y), BR = max(x+y), TR = min(y−x), BL = max(y−x).
  - `outputSize(q: Quad, maxSide = 3000): { width: number; height: number }` — max opposite edge lengths, then scaled down uniformly if long side > `maxSide`; rounded.
  - `scaleQuad(q: Quad, s: number): Quad`
  - `fullFrameQuad(w: number, h: number): Quad`
  - `clampQuad(q: Quad, w: number, h: number): Quad`
  - `isValidQuad(q: Quad, frameW: number, frameH: number, minAreaFrac = 0.2): boolean` — convex, area ≥ frac, angles in [45°, 135°].
  - `class StabilityTracker { constructor(opts?: { alpha?: number; thresholdFrac?: number; holdMs?: number; cooldownMs?: number }); update(q: Quad | null, diag: number, now: number): { smoothed: Quad | null; fire: boolean }; reset(): void }` defaults α 0.5, 0.02, 800, 1500.

- [ ] **Step 1: Write failing tests:**
  - `orderCorners` on shuffled `[(100,10),(10,10),(10,100),(100,100)]` → `[(10,10),(100,10),(100,100),(10,100)]`.
  - `outputSize` of quad with top 200, bottom 220, left 300, right 310 → `{220, 310}`; a 6000×8000 quad → `{2250, 3000}`.
  - `isValidQuad`: full-frame → true; 10% area square → false; bow-tie (TL,BR,TR,BL order) → false; quad with a 30° corner → false.
  - `clampQuad` with `(-5, 2000)` on 1000×1000 → `(0, 1000)`.
  - `StabilityTracker`: identical quad fed at t=0,100,…,700 → `fire` false; at t=800 → true; at t=900 → false (cooldown); jitter of 3% diag at t=400 resets hold so fire happens no earlier than t=1200; `null` input resets and returns `smoothed: null`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/geometry.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/cv/geometry.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cv): quad geometry and stability tracker`.

### Task 3: CV pipeline (detect, warp, enhance) with fixtures

**Files:**
- Create: `src/cv/types.ts`, `src/cv/detect.ts`, `src/cv/process.ts`, `tests/fixtures/generate.ts`, `tests/fixtures/*.png` + `tests/fixtures/truth.json`, `tests/cv/loadCv.ts`, `tests/cv/detect.test.ts`, `tests/cv/process.test.ts`

**Interfaces:**
- Consumes: `orderCorners`, `isValidQuad`, `scaleQuad`, `outputSize` (Task 2).
- Produces:
  - `detectQuad(cv: CV, img: ImageData): Quad | null` — quad in `img` pixel coords.
  - `warp(cv: CV, img: ImageData, q: Quad): ImageData`
  - `enhance(cv: CV, img: ImageData, mode: FilterMode): ImageData`
  - `tests/cv/loadCv.ts`: `loadCv(): Promise<CV>` (awaits `@techstark/opencv-js` runtime init); `readPng(path): ImageData`; `writePng`.

- [ ] **Step 1: Fixture generator.** `tests/fixtures/generate.ts` (run with `npx tsx`, uses `pngjs` + OpenCV) renders a 1200×1600 "page" (white, black text-like bars, plus the phrase `INVOICE 2026` in ~80 px sans-serif near the top so E2E OCR has a known string) and perspective-warps it onto a background at a known quad, writing PNG + entry in `truth.json` (`{ file, quad | null }`). Five fixtures:
  - `dark-desk` (bg rgb 40,35,30 + noise),
  - `light-desk` (bg rgb 200,195,185, low contrast),
  - `steep-angle` (top edge ≈ 55% of bottom edge),
  - `crumpled` (page edges displaced by ±6 px sinusoid, shading gradient),
  - `no-page` (textured bg only, `quad: null`).
  Output images 1440×1920. Commit generated files.
- [ ] **Step 2: Write failing tests** `tests/cv/detect.test.ts`: for each fixture with a quad, downscale to long side 480, `detectQuad`, scale result back, assert every corner within `0.02 × diagonal` of truth. For `no-page`, result is `null`.
- [ ] **Step 3: Write failing tests** `tests/cv/process.test.ts`:
  - `warp` of `dark-desk` with its truth quad → width/height equal `outputSize(truth)` and mean of the center 50% region > 200 (page is white).
  - `warp caps long side at 3000`: synthetic 4000×6000 white ImageData with full-frame quad → long side 3000.
  - `enhance('bw')` output pixels are only 0 or 255.
  - `enhance('magic')` on an image with a left→right brightness gradient (120→240 on a white page): std-dev of a blank-row region drops by ≥ 50%.
  - `enhance('original')` returns identical pixels.
  - All functions `.delete()` their Mats: `cv.Mat` live count (wrap constructor in test) unchanged after each call.
- [ ] **Step 4: Run** `npx vitest run tests/cv` → FAIL.
- [ ] **Step 5: Implement** `detect.ts` exactly per spec §3 Live detection steps 3–5 (Canny thresholds 0.66/1.33 × median gray, 5×5 Gaussian, 3×3 dilate once, `RETR_EXTERNAL`, `approxPolyDP` ε = 0.02·perimeter, filter with `isValidQuad`, largest area; Otsu + morphological close fallback). Implement `process.ts` per spec §3 Warp and Enhance filters (`INTER_CUBIC`; magic kernel ≈ long/30, then median blur, divide, 1st–99th percentile stretch, saturation ×1.15; bw adaptive Gaussian block = odd ≈ long/40, C = 10). Use try/finally to free Mats.
- [ ] **Step 6: Run** → PASS. If a fixture fails accuracy, tune only within the spec's parameters, and record the fixture/result in the commit message.
- [ ] **Step 7: Commit** `feat(cv): page detection, perspective warp, enhance filters`.

### Task 4: CV worker, client, and image helpers

**Files:**
- Create: `src/cv/cv.worker.ts`, `src/cv/client.ts`, `src/image.ts`
- Test: `tests/unit/image.test.ts`

**Interfaces:**
- Consumes: `detectQuad`, `warp`, `enhance` (Task 3).
- Produces:
  - `interface CvApi { ready(): Promise<void>; detect(img: ImageData): Promise<Quad | null>; warp(img: ImageData, q: Quad): Promise<ImageData>; enhance(img: ImageData, mode: FilterMode): Promise<ImageData> }` — ES module worker (`new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' })`) that does `await import('@techstark/opencv-js')` so Vite bundles OpenCV into a same-origin worker chunk (OpenCV is therefore NOT copied by `copy-vendor.mjs`); `ready()` resolves after the runtime's `onRuntimeInitialized`. ImageData buffers sent with `Comlink.transfer`.
  - `getCv(): Remote<CvApi>` singleton; `onCvProgress(cb: (loaded: boolean) => void)`.
  - `loadBitmap(blob: Blob): Promise<ImageBitmap>` — `createImageBitmap(blob, { imageOrientation: 'from-image' })`.
  - `imageDataFromBitmap(b: ImageBitmap, maxSide?: number): ImageData`
  - `imageDataToBlob(img: ImageData, type = 'image/jpeg', quality = 0.9): Promise<Blob>`
  - `makeThumb(img: ImageData, maxSide = 256): Promise<Blob>`
  - `fitWithin(w: number, h: number, maxSide: number): { width: number; height: number }`

- [ ] **Step 1: Write failing test** `tests/unit/image.test.ts`: `fitWithin(4000, 3000, 480)` → `{480, 360}`; `fitWithin(100, 50, 480)` → `{100, 50}` (never upscales).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check:** in `npm run dev`, from the browser console run `const {getCv}=await import('/src/cv/client.ts'); await getCv().ready()` → resolves with no CSP violations in the console. (Detection correctness is covered by Task 3 tests and Task 11 E2E.)
- [ ] **Step 6: Commit** `feat(cv): worker + client and image helpers`.

### Task 5: Store

**Files:**
- Create: `src/store/store.ts`
- Test: `tests/unit/store.test.ts` (uses `fake-indexeddb/auto`)

**Interfaces:**
- Produces (DB name `scanner`, version 1, stores `documents`, `pages` (index `byDoc` on `docId`), `settings`):
  - `createDocument(name?: string): Promise<Document>` — default name `Scan YYYY-MM-DD HH:mm`.
  - `listDocuments(): Promise<Document[]>` — sorted `updatedAt` desc.
  - `getDocument(id)`, `renameDocument(id, name)`, `deleteDocument(id)` (deletes its pages in the same transaction).
  - `addPage(docId: string, p: Omit<Page, 'id' | 'docId'>): Promise<Page>` — appends id to `pageIds`, bumps `updatedAt`.
  - `getPage(id)`, `updatePage(id, patch: Partial<Page>)`, `deletePage(id)` (removes from `pageIds`), `reorderPages(docId, pageIds: string[])` (must be a permutation, else throws).
  - `getSettings(): Promise<Settings>` (defaults `{pageSize:'A4', autoCapture:true}`), `saveSettings(s)`.
  - `requestPersist(): Promise<void>` — calls `navigator.storage?.persist()` once.

- [ ] **Step 1: Write failing tests:** create/list order; rename; addPage appends and bumps `updatedAt`; `deleteDocument removes its pages` (`getPage` of each → `undefined`); deletePage removes id; reorder with a non-permutation throws; settings default and round-trip.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(store): IndexedDB documents, pages, settings`.

### Task 6: OCR worker and queue

**Files:**
- Create: `src/ocr/ocr.worker.ts`, `src/ocr/queue.ts`
- Test: `tests/unit/ocrQueue.test.ts`

**Interfaces:**
- Consumes: `getPage`, `updatePage` (Task 5).
- Produces:
  - `interface OcrApi { recognize(blob: Blob): Promise<OcrResult> }` — Tesseract `createWorker('eng', 1, { workerPath, corePath, langPath: '/vendor/tesseract/...' })`, `tessedit_pageseg_mode: '3'`; maps words to `OcrWord` in processed-image pixel coords.
  - `createOcrQueue(recognize: (b: Blob) => Promise<OcrResult>): { enqueue(pageId: string): void; onChange(cb: (pageId: string, status: OcrStatus) => void): () => void; idle(): Promise<void> }`
  - `ocrQueue` — app singleton wired to the real worker.

- [ ] **Step 1: Write failing tests** with a fake `recognize`: two enqueued pages run sequentially (second starts after first resolves); success writes `ocr` + `ocrStatus:'done'`; rejection writes `ocrStatus:'failed'` and the next item still runs; `idle()` resolves when empty; enqueuing an already-queued id is a no-op.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ocr): Tesseract worker and sequential queue`.

### Task 7: PDF builder and export

**Files:**
- Create: `src/pdf/pdf.ts`, `src/export.ts`
- Test: `tests/unit/pdf.test.ts`

**Interfaces:**
- Produces:
  - `interface ExportPage { jpeg: Uint8Array; width: number; height: number; ocr?: OcrResult }`
  - `PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792] } as const`
  - `placeImage(imgW, imgH, pageW, pageH): { x: number; y: number; w: number; h: number; scale: number }` — fit inside, centered.
  - `toWinAnsi(s: string): string` — drop chars Helvetica's WinAnsi encoding can't encode.
  - `buildPdf(pages: ExportPage[], opts: { pageSize: 'A4' | 'Letter' }): Promise<Uint8Array>` — throws `Error('No pages to export')` on empty input. Text per word: Helvetica, size = `bboxWidth·scale / font.widthOfTextAtSize(text, 1)`, x = `place.x + x0·scale`, y = `place.y + (imgH − y1)·scale`, render mode invisible (`3 Tr` via `pushOperators(setTextRenderingMode(3))` around `drawText`).
  - `exportPdf(bytes: Uint8Array, name: string): Promise<'shared' | 'downloaded'>` and `exportJpegs(blobs: Blob[], name: string)` — `navigator.canShare({files})` → `share`, else anchor download of object URL (revoked after click).

- [ ] **Step 1: Write failing tests** (`pdfjs-dist` legacy build to read back):
  - `placeImage(1000, 2000, 595.28, 841.89)` → h = 841.89, centered x.
  - Two pages with OCR words `["Hello","World"]` and `["Invoice"]` → PDF has 2 pages; page sizes match A4; `getTextContent()` of page 1 joins to contain `Hello World`; first item's transform x within 2 pt of expected.
  - `strips non-WinAnsi characters`: word `"a→b😀"` → exported text `ab`, no throw.
  - Letter option → page size 612×792.
  - Empty input rejects with `No pages to export`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(pdf): searchable PDF builder and share/download export`.

### Task 8: Camera and auto-capture controller

**Files:**
- Create: `src/camera/camera.ts`, `src/camera/autocapture.ts`
- Test: `tests/unit/autocapture.test.ts`

**Interfaces:**
- Consumes: `StabilityTracker`, `scaleQuad` (Task 2); `CvApi.detect` (Task 4); `fitWithin` (Task 4).
- Produces:
  - `class Camera { start(video: HTMLVideoElement): Promise<void>; stop(): void; sampleFrame(maxSide: number): { img: ImageData; scale: number }; capture(): Promise<Blob> }` — `getUserMedia({ video: { facingMode: 'environment', width: { ideal: 4096 } }, audio: false })`; `capture` uses `ImageCapture.takePhoto()` when available else full-res canvas grab → JPEG 0.95. Errors normalized: `CameraError` with `kind: 'denied' | 'unavailable' | 'insecure'`.
  - `startAutoCapture(deps: { sample: () => { img: ImageData; scale: number } | null; detect: (img: ImageData) => Promise<Quad | null>; onQuad: (q: Quad | null) => void; onFire: () => void; enabled: () => boolean; now?: () => number; schedule?: (fn: () => void, ms: number) => number; cancel?: (id: number) => void }): () => void` — ticks every 100 ms, skips tick while a detect is in flight, scales quad by `1/scale` to full-res, feeds `StabilityTracker` with full-res diagonal, calls `onFire` only if `enabled()`. Returns stop function. Also restarts sampling after `visibilitychange` to visible (caller restarts `Camera` stream).

- [ ] **Step 1: Write failing tests** with fake clock/scheduler: steady quad → `onFire` once at ≥ 800 ms; in-flight detect (never-resolving promise) → `detect` called once across 5 ticks; `enabled()` false → `onQuad` still called, `onFire` never; returned stop fn cancels further ticks; quad is scaled to full-res before `onQuad`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** both files (Camera is covered by E2E in Task 11). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(camera): camera wrapper and auto-capture controller`.

### Task 9: Page pipeline, Crop editor, Filter picker

**Files:**
- Create: `src/pages/savePage.ts`, `src/ui/CropEditor.tsx`, `src/ui/FilterPicker.tsx`
- Test: `tests/unit/savePage.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.
- Produces:
  - `savePage(docId: string, original: Blob, opts: { quad?: Quad; filter?: FilterMode; cv: Pick<CvApi,'detect'|'warp'|'enhance'> }): Promise<Page>` — if no quad: detect on 480-px copy, scale up, else `fullFrameQuad`; warp + enhance full-res; processed JPEG 0.9; thumb; `ocrStatus: 'pending'`; `addPage`; `ocrQueue.enqueue`. Default filter `'magic'`.
  - `reprocessPage(pageId: string, patch: { quad?: Quad; filter?: FilterMode }, cv): Promise<Page>` — re-derives from `originalBlob`, resets OCR to pending and re-enqueues.
  - `<CropEditor page={Page} onDone={(q: Quad) => void} onCancel />` — four draggable handles (pointer events), loupe (2× zoom, 120 px circle) while dragging, buttons "Full image" (`fullFrameQuad`) and "Auto-detect"; every move passes through `clampQuad`; Apply disabled when `!isValidQuad(q, w, h, 0)`.
  - `<FilterPicker page={Page} onDone={(f: FilterMode) => void} />` — four previews from a 400-px copy.

- [ ] **Step 1: Write failing tests** for `savePage`/`reprocessPage` with fake cv + fake-indexeddb + stubbed image helpers: no-quad path calls `detect` then falls back to `fullFrameQuad` when detect returns null; provided quad skips `detect`; page appended to doc and enqueued; `reprocessPage` with new filter keeps `originalBlob` byte-identical and sets `ocrStatus:'pending'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `savePage.ts`, then the two components. **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check** in `npm run dev`: drag a handle past the image edge → it stops at the edge; drag into a bow-tie → Apply disabled.
- [ ] **Step 6: Commit** `feat: page save/reprocess pipeline, crop editor, filter picker`.

### Task 10: Screens — Library, Camera, DocumentView, Settings, errors

**Files:**
- Create: `src/ui/Library.tsx`, `src/ui/CameraScreen.tsx`, `src/ui/DocumentView.tsx`, `src/ui/Settings.tsx`, `src/ui/Toast.tsx`, `src/ui/styles.css`
- Modify: `src/app.tsx`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: `type Screen = { name: 'library' } | { name: 'camera'; docId: string } | { name: 'doc'; docId: string } | { name: 'crop'; pageId: string } | { name: 'filter'; pageId: string } | { name: 'settings' }` in `app.tsx`; `toast(msg: string, kind?: 'info' | 'error')`.

Behaviour (spec §5, §6):
- Library: grid (thumb of first page, name, page count, date); New scan creates a doc and opens Camera; rename inline; delete with `confirm`.
- CameraScreen: `<video>` + overlay canvas drawing smoothed quad; Auto toggle (default from Settings); shutter; gallery `<input type=file accept="image/*" multiple>`; page counter; Done → DocumentView. On `CameraError`: `insecure` → banner "Camera requires HTTPS"; `denied`/`unavailable` → message + gallery button prominent. While `getCv().ready()` pending: "Loading scanner…" indicator; captures queue until ready. Restart stream on `visibilitychange` → visible. First save calls `requestPersist()`.
- DocumentView: page grid with drag-to-reorder (pointer events, `reorderPages`), per-page OCR badge (pending/done/failed), tap → Crop then Filter, delete page, Add pages, Export PDF (if any page `pending`: dialog "Waiting for text recognition…" with progress and "Export without text" button), Export JPEGs.
- Quota errors (`QuotaExceededError` from store) → toast "Storage full — delete some scans".

- [ ] **Step 1: Implement** screens and wire `app.tsx`.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run` → clean / PASS.
- [ ] **Step 3: Manual check** on desktop Chrome with webcam and on a phone via `npm run dev -- --host` behind HTTPS (`@vitejs/plugin-basic-ssl`): scan 2 pages, reorder, export PDF, search text in the PDF viewer.
- [ ] **Step 4: Commit** `feat(ui): library, camera, document view, settings`.

### Task 11: PWA offline + E2E

**Files:**
- Modify: `vite.config.ts` (add `VitePWA({ registerType: 'autoUpdate', workbox: { globPatterns: ['**/*.{js,css,html,wasm,png,svg}', 'vendor/**/*'], maximumFileSizeToCacheInBytes: 15_000_000 }, manifest: { name: 'Scanner', short_name: 'Scanner', display: 'standalone', ... } })`)
- Create: `playwright.config.ts`, `tests/e2e/scan.spec.ts`, `tests/e2e/offline.spec.ts`, `tests/fixtures/page.y4m` (generated from `dark-desk.png` held still for 3 s via `ffmpeg -loop 1 -t 3 -i ... -pix_fmt yuv420p`), `tests/fixtures/rotated.jpg` (portrait page with EXIF Orientation=6)

**Interfaces:**
- Consumes: built app (`npm run build && npm run preview`).

- [ ] **Step 1: Write failing E2E** `scan.spec.ts` (Chromium, `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=tests/fixtures/page.y4m`): New scan → page counter reaches 1 without clicking shutter (auto-capture) within 10 s → Done → open page Crop → Apply → Filter `bw` → Export PDF (stub `navigator.canShare` false; capture download) → parse with pdfjs: 1 page, text contains `INVOICE 2026`.
- [ ] **Step 2: Write failing E2E** import test in same file: gallery import `rotated.jpg` → saved thumbnail is portrait (height > width).
- [ ] **Step 3: Write failing E2E** `offline.spec.ts`: load app, wait for SW `ready`, `context.setOffline(true)`, reload → library renders and Camera screen shows no "Loading scanner…" after 10 s; collect all requests during the session and assert every URL origin equals the app origin.
- [ ] **Step 4: Run** `npm run test:e2e` → FAIL. **Step 5: Implement** PWA config and fix any gaps. **Step 6: Run** → PASS.
- [ ] **Step 7: Commit** `feat: offline PWA and end-to-end tests`.

### Task 12: Research deliverable

**Files:**
- Create: `docs/camscanner-research.md`

- [ ] **Step 1: Research** public sources (WebSearch): Kaspersky Securelist Aug 2019 CamScanner / Necro dropper (`Trojan-Dropper.AndroidOS.Necro.n`) report; Google Play removal and INTSIG response; CamScanner privacy policy (data collected, cloud sync, account, third parties); any public technical write-ups of its scanning approach.
- [ ] **Step 2: Write** the doc per spec §7. Every claim ends with `[public: <URL>]` or `[unknown — needs binary]`. Sections: Scan pipeline; Network/API & cloud model; Privacy & security history; How this clone differs (link spec); Open questions + how to resolve with an APK (jadx, network capture).
- [ ] **Step 3: Verify** every `[public: …]` URL was actually fetched in Step 1; no endpoint names or SDK lists asserted without a source.
- [ ] **Step 4: Commit** `docs: CamScanner public-source research notes`.
