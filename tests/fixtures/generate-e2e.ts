/**
 * E2E fixtures derived from `dark-desk.png` (run after generate.ts; `npm run fixtures` runs both,
 * Playwright's globalSetup runs them when stale). Outputs are git-ignored:
 *  - page.y4m: the page held still for 3 s at 10 fps (960x1280, I420), fed to Chromium's fake camera.
 *  - rotated.jpg: the portrait page stored landscape (rotated 90° CCW) with EXIF Orientation=6.
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { readPng } from '../cv/loadCv';
import { GENERATED_DIR, generatorHash } from './generate';

const SELF = fileURLToPath(import.meta.url);
const STAMP = '.e2e-generator-hash';
export const Y4M = 'page.y4m';
export const ROTATED = 'rotated.jpg';
const Y4M_W = 960;
const Y4M_H = 1280;
const FPS = 10;
const SECONDS = 3;

function e2eHash(): string {
  return createHash('sha256').update(readFileSync(SELF)).update(generatorHash()).digest('hex');
}

export function e2eFixturesUpToDate(outDir = GENERATED_DIR): boolean {
  const stamp = join(outDir, STAMP);
  return (
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8').trim() === e2eHash() &&
    [Y4M, ROTATED].every((n) => existsSync(join(outDir, n)))
  );
}

/** Bilinear resize of RGBA pixels. */
function resize(src: ImageData, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * src.width + x0) * 4 + c];
        const b = src.data[(y0 * src.width + x1) * 4 + c];
        const d = src.data[(y1 * src.width + x0) * 4 + c];
        const e = src.data[(y1 * src.width + x1) * 4 + c];
        out[(y * w + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

/** RGBA -> I420 (BT.601 limited range), chroma averaged over 2x2 blocks. */
function toI420(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  const cw = w / 2;
  const ch = h / 2;
  const buf = Buffer.alloc(w * h + 2 * cw * ch);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    buf[i] = Math.round(16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255);
  }
  const uOff = w * h;
  const vOff = uOff + cw * ch;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((2 * y + dy) * w + 2 * x + dx) * 4;
        r += rgba[i];
        g += rgba[i + 1];
        b += rgba[i + 2];
      }
      r /= 4; g /= 4; b /= 4;
      buf[uOff + y * cw + x] = Math.round(128 + (-37.797 * r - 74.203 * g + 112 * b) / 255);
      buf[vOff + y * cw + x] = Math.round(128 + (112 * r - 93.786 * g - 18.214 * b) / 255);
    }
  }
  return buf;
}

function writeY4m(path: string, src: ImageData): void {
  const frame = toI420(resize(src, Y4M_W, Y4M_H), Y4M_W, Y4M_H);
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, `YUV4MPEG2 W${Y4M_W} H${Y4M_H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
    for (let i = 0; i < FPS * SECONDS; i++) {
      writeSync(fd, 'FRAME\n');
      writeSync(fd, frame);
    }
  } finally {
    closeSync(fd);
  }
}

/** APP1 segment holding a big-endian TIFF with a single IFD0 entry: Orientation (0x0112) = 6. */
function exifOrientation6(): Buffer {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at offset 8
    0x00, 0x01, // 1 entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // Orientation SHORT x1 = 6
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), len, payload]);
}

function writeRotatedJpeg(path: string, src: ImageData): void {
  // Displayed (portrait) image rotated 90° CCW: stored(x, y) = displayed(W - 1 - y, x).
  const W = src.width;
  const sw = src.height;
  const sh = src.width;
  const data = Buffer.alloc(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = (x * W + (W - 1 - y)) * 4;
      const di = (y * sw + x) * 4;
      data[di] = src.data[si];
      data[di + 1] = src.data[si + 1];
      data[di + 2] = src.data[si + 2];
      data[di + 3] = 255;
    }
  }
  const jpg = Buffer.from(jpeg.encode({ data, width: sw, height: sh }, 90).data);
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8) throw new Error('unexpected JPEG start');
  // Replace jpeg-js's JFIF APP0 (if any) with the EXIF APP1, as cameras write it.
  const rest = jpg[2] === 0xff && jpg[3] === 0xe0 ? jpg.subarray(4 + jpg.readUInt16BE(4)) : jpg.subarray(2);
  writeFileSync(path, Buffer.concat([jpg.subarray(0, 2), exifOrientation6(), rest]));
}

export function generateE2eFixtures(outDir = GENERATED_DIR): void {
  const src = readPng(join(outDir, 'dark-desk.png'));
  writeY4m(join(outDir, Y4M), src);
  console.log(`wrote ${Y4M}`);
  writeRotatedJpeg(join(outDir, ROTATED), src);
  console.log(`wrote ${ROTATED}`);
  writeFileSync(join(outDir, STAMP), e2eHash() + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) generateE2eFixtures();
