export function fitWithin(w: number, h: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  // Extreme aspect ratios must not round a side to 0 (an empty canvas / ImageData throws).
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

type Canvas2D = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
};

function makeCanvas(width: number, height: number): Canvas2D {
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d') as Canvas2D['ctx'] | null;
  if (!ctx) throw new Error('2d canvas context unavailable');
  return { canvas, ctx };
}

function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality),
  );
}

export function imageDataFromBitmap(b: ImageBitmap, maxSide?: number): ImageData {
  const { width, height } = maxSide ? fitWithin(b.width, b.height, maxSide) : { width: b.width, height: b.height };
  const { ctx } = makeCanvas(width, height);
  ctx.drawImage(b, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function imageDataToBlob(img: ImageData, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  const { canvas, ctx } = makeCanvas(img.width, img.height);
  ctx.putImageData(img, 0, 0);
  return canvasToBlob(canvas, type, quality);
}

export async function makeThumb(img: ImageData, maxSide = 256): Promise<Blob> {
  const { width, height } = fitWithin(img.width, img.height, maxSide);
  const src = makeCanvas(img.width, img.height);
  src.ctx.putImageData(img, 0, 0);
  const dst = makeCanvas(width, height);
  dst.ctx.drawImage(src.canvas as CanvasImageSource, 0, 0, width, height);
  return canvasToBlob(dst.canvas, 'image/jpeg', 0.8);
}
