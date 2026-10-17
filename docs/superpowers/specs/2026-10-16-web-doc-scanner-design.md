# Web Document Scanner — Design Spec

Date: 2026-10-16
Status: Approved design, pending spec review

## 1. Intent

**Stated by user**
- Clean-room rebuild of a CamScanner-style document scanner (no CamScanner binary is available or used).
- Understand CamScanner's scan pipeline, network/API, and privacy/security posture.
- Platform: web app / PWA.
- Storage: local-only.
- v1 features: auto edge detection, crop/perspective correction, multi-page PDF export, enhance filters, OCR + searchable PDF, document library, live camera auto-capture.

**Assumptions (correct if wrong)**
- Personal / learning project, not a commercial product.
- Privacy is a design goal: no trackers, no third-party network calls, all processing on-device.

**Success criteria**
1. On a phone browser, pointing the camera at a page shows a stable live outline and auto-captures within ~1 s of holding steady.
2. Detected corners land within 2% of the image diagonal of hand-marked ground truth on the fixture set (excluding the "no page" fixture, which must return no quad).
3. Exported multi-page PDF opens in standard viewers, and its text is searchable/selectable.
4. App works fully offline after first load; a CSP blocks all non-self network requests, enforced by response header where the host supports it (config shipped: `_headers` generated into the build, nginx snippet in `docs/deploy.md`); page-level meta otherwise.

## 2. Architecture

- **Stack:** Vite + TypeScript + Preact; PWA via service worker (precaches app shell, OpenCV.js WASM, Tesseract core + `eng.traineddata`).
- **Units**

| Unit | Responsibility | Interface | Depends on |
|---|---|---|---|
| `src/cv/cv.worker.ts` | All OpenCV work off main thread | `detect(ImageData) → Quad \| null`, `warp(ImageBitmap, Quad) → ImageBitmap`, `enhance(ImageBitmap, FilterMode) → ImageBitmap` (via Comlink) | OpenCV.js |
| `src/cv/geometry.ts` | Pure math: corner ordering, output size, quad scaling, stability check | pure functions | none |
| `src/ocr/ocr.worker.ts` | Text recognition | `recognize(Blob) → OcrResult {words: {text, bbox, confidence}[], width, height}` | Tesseract.js |
| `src/pdf/pdf.ts` | PDF assembly with invisible text layer | `buildPdf(pages: ExportPage[], opts) → Uint8Array` | pdf-lib |
| `src/store/store.ts` | Persistence | CRUD for `Document`, `Page` | idb |
| `src/camera/camera.ts` | getUserMedia, frame sampling, still capture | `start()`, `sampleFrame(maxSide)`, `capture()` | browser APIs |
| `src/ui/*` | Screens: Library, Camera, CropEditor, FilterPicker, DocumentView, Settings | Preact components | all above |

- **Detector boundary:** `detect` is the only entry point for page finding so a future ML detector can replace it.

### Data model (IndexedDB `scanner` db, v1)

```ts
type Quad = [Point, Point, Point, Point]; // ordered TL, TR, BR, BL, full-res pixel coords
type FilterMode = 'original' | 'magic' | 'gray' | 'bw';

interface Document { id: string; name: string; createdAt: number; updatedAt: number; pageIds: string[]; }
interface Page {
  id: string; docId: string;
  originalBlob: Blob;        // full-res capture, never modified
  quad: Quad; filter: FilterMode;
  processedBlob: Blob;       // warp + enhance output (JPEG 0.9)
  thumbBlob: Blob;           // ~256px
  ocr?: OcrResult;           // filled asynchronously
}
```
Re-crop / re-filter regenerates `processedBlob` from `originalBlob`.

### Network policy
CSP: `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`. All libraries and language data self-hosted. No analytics.

OpenCV.js (embind) builds some helpers with `new Function`, which this CSP forbids (no `'unsafe-eval'`). Rather than allowing eval, `build/opencvNoEval.ts` patches OpenCV.js at build time, rewriting the four code-generation sites (`createNamedFunction`, `makeDynCaller`, `craftInvokerFunction`, `__emval_get_method_caller`) into closures. The build throws if an expected site is missing, and a `generateBundle` scan fails it if any `new Function`/`eval(` remains in the OpenCV chunk.

## 3. Scan pipeline

### Live detection
1. Rear camera via `getUserMedia({video:{facingMode:'environment', width:{ideal:4096}}})`.
2. ~10 Hz: draw video frame to OffscreenCanvas downscaled so long side = 480 px; transfer `ImageData` to worker. Drop frames while a detection is in flight.
3. Worker: grayscale → GaussianBlur 5×5 → Canny with thresholds `0.66·median`, `1.33·median` (median of the blurred gray) → dilate 3×3 once.
4. `findContours(RETR_EXTERNAL)` → for each, `approxPolyDP(ε = 0.02·perimeter)`. Keep candidates that are 4-vertex, convex, area ≥ 20% of frame, every interior angle in [45°, 135°], and not a whole-frame artifact (rejected only when each ordered corner lies within 1%, per axis of the respective dimension, of its own frame corner: TL↔(0,0), TR↔(w,0), BR↔(w,h), BL↔(0,h); a page merely spanning the full width or height is kept). Choose largest area.
5. Cascade if none: retry steps 3–4 with Canny thresholds `0.33·median`, `0.66·median` (catches low-contrast page edges, e.g. white paper on a light desk); if still none, Otsu threshold → morphological close → same contour filter (the border rule stops Otsu's text-vs-everything split from returning the frame). No valid quad → null.
6. Scale quad to full-res coordinates; order corners TL/TR/BR/BL (sum/diff method in `geometry.ts`).

### Overlay & auto-capture
- Canvas overlay draws quad; corners smoothed with exponential moving average (α = 0.5).
- Stability: max corner displacement < 2% of frame diagonal sustained ≥ 800 ms → auto-capture, then 1.5 s cooldown. Auto-capture toggle in camera UI; manual shutter always present.
- Still: `ImageCapture.takePhoto()` if supported, else full-res video frame grab. Re-run `detect` on the still (downscaled) to refine; if it fails, use the live quad.

### Warp
Output width = max(|TR−TL|, |BR−BL|), height = max(|BL−TL|, |BR−TR|); `getPerspectiveTransform` + `warpPerspective(INTER_CUBIC)`. Cap output long side at 3000 px.

### Enhance filters
- `original`: unchanged.
- `magic`: per channel, background = morphological close (kernel ≈ 1/30 of long side) then median blur; `out = src / background · 255`; then CLAHE-free contrast stretch (1st–99th percentile) and saturation ×1.15.
- `gray`: grayscale → same background normalization → contrast stretch.
- `bw`: grayscale → background normalization → `adaptiveThreshold(GAUSSIAN_C, block = odd ≈ 1/40 long side, C = 10)`. Sauvola is a deferred alternative, not v1.

### OCR
After a page is saved, enqueue OCR (single worker, sequential). Language `eng`, PSM 3. Store word text + bbox in processed-image pixel coords. UI shows OCR status per page; export waits (with progress) for pending OCR or offers "export without text".

## 4. Export

- `pdf-lib`: page size A4 (default) or Letter from Settings. Image = `processedBlob` re-encoded JPEG 0.85, fit inside page with 0 margin, aspect preserved, centered.
- Text layer: for each word, standard Helvetica, `size` chosen so `widthOfTextAtSize(text) ≈ bbox width` scaled to page; position at bbox baseline (bbox bottom mapped to PDF coords, y-flipped); rendering mode 3 (invisible) via raw operator `3 Tr`. Non-WinAnsi characters stripped from the text layer (English-only v1).
- Delivery: `navigator.share({files})` when `canShare` passes, else download via object URL. Also "Export pages as JPEG" (individual files or share sheet).

## 5. UI flows

- **Library:** grid of documents (first-page thumb, name, page count, date). New scan, open, rename, delete (confirm).
- **Camera:** live preview + overlay, auto toggle, shutter, gallery import (`<input type=file accept=image/* multiple>`), page counter, Done → DocumentView.
- **CropEditor:** full image with 4 draggable corner handles (touch + mouse), loupe magnifier while dragging, "full image" and "auto-detect" buttons.
- **FilterPicker:** 4 thumbnails previewed from a downscaled copy; apply runs full-res.
- **DocumentView:** page grid, drag-to-reorder, tap page → Crop/Filter, delete page, add pages, Export PDF / JPEG.
- **Settings:** page size, auto-capture default.

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Camera permission denied / no camera | Message + gallery import path |
| No quad detected | Crop editor defaults to full-image quad |
| OpenCV/Tesseract still loading | Progress indicator; capture allowed, processing queued |
| Non-HTTPS context | Banner: camera requires HTTPS |
| IndexedDB quota exceeded | Error toast; request `navigator.storage.persist()` on first save |
| OCR failure on a page | Page marked "no text"; export continues without its text layer |

## 7. Research deliverable

`docs/camscanner-research.md`, every claim tagged **[public: citation]** or **[unknown — needs binary]**:
- Scan pipeline as publicly understood (classic edge/contour/warp approach, enhancement filters).
- 2019 Kaspersky report: Android CamScanner versions shipped an ad library containing the Necro trojan dropper module; Google Play removal and subsequent fix.
- Account / cloud sync / subscription model, per CamScanner's privacy policy.
- Explicit list of what remains unknown (endpoints, payloads, SDK inventory of current versions) and how to resolve it (APK decompilation).

## 8. Testing

- **Unit (Vitest):** `geometry.ts` (ordering, output size, scaling, stability), store CRUD (fake-indexeddb), PDF text layer coordinate mapping (parse output with pdfjs-dist, assert text order and approximate positions).
- **CV fixtures:** Node + `@techstark/opencv-js`; `tests/fixtures/` with: dark desk, light desk, steep angle, crumpled receipt, no page. JSON ground-truth quads. Pass = all corners within 2% of diagonal; "no page" returns null or fallback-full-frame.
- **E2E (Playwright, Chromium):** `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=tests/fixtures/page.y4m`: auto-capture fires, crop accept, filter apply, export PDF; assert page count and extracted text contains a known phrase.

## 9. Out of scope (v1)

Accounts, sync, any backend; non-English OCR; signatures, watermarks, ID-card mode, annotations; ML detector; Sauvola thresholding; batch import of PDFs.
