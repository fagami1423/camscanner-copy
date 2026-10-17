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
  /**
   * Bumped whenever processedBlob is regenerated, so an OCR result for an older image is discarded.
   * New pages start at 0; records saved before this field existed lack it and count as 0.
   */
  rev: number;
}
export interface Settings { pageSize: 'A4' | 'Letter'; autoCapture: boolean }
