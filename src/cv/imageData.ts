/** Build an ImageData when the global exists (browser/worker), else a same-shape object (Node tests). */
export function makeImageData(data: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): ImageData {
  if (typeof ImageData !== 'undefined') return new ImageData(data, width, height);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}
