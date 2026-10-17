import { fitWithin } from '../image';

export type CameraErrorKind = 'denied' | 'unavailable' | 'insecure';

export class CameraError extends Error {
  kind: CameraErrorKind;
  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.name = 'CameraError';
    this.kind = kind;
  }
}

function normalize(e: unknown): CameraError {
  const name = (e as { name?: string } | null)?.name;
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || name === 'SecurityError') return new CameraError('denied', msg);
  return new CameraError('unavailable', msg);
}

export class Camera {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    if (!window.isSecureContext) throw new CameraError('insecure', 'Camera requires a secure context (HTTPS)');
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unavailable', 'Camera API unavailable');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 4096 } },
        audio: false,
      });
      this.video = video;
      video.srcObject = this.stream;
      video.muted = true;
      video.setAttribute('playsinline', '');
      await video.play();
    } catch (e) {
      this.stop();
      throw normalize(e);
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }

  private ctx(w: number, h: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    if (!this.canvas) {
      this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    }
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const c = this.canvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!c) throw new CameraError('unavailable', 'Canvas 2D unavailable');
    return c;
  }

  sampleFrame(maxSide: number): { img: ImageData; scale: number } | null {
    const v = this.video;
    if (!v || v.videoWidth === 0) return null;
    const { width, height } = fitWithin(v.videoWidth, v.videoHeight, maxSide);
    const c = this.ctx(width, height);
    c.drawImage(v, 0, 0, width, height);
    return { img: c.getImageData(0, 0, width, height), scale: width / v.videoWidth };
  }

  private async grabFrame(): Promise<Blob> {
    const v = this.video;
    if (!v || v.videoWidth === 0) throw new CameraError('unavailable', 'Camera not ready');
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))), 'image/jpeg', 0.95),
    );
  }

  async capture(): Promise<Blob> {
    const track = this.stream?.getVideoTracks()[0];
    if (track && 'ImageCapture' in window) {
      try {
        const IC = (window as unknown as { ImageCapture: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
        return await new IC(track).takePhoto();
      } catch {
        /* fall back to frame grab */
      }
    }
    return this.grabFrame();
  }
}
