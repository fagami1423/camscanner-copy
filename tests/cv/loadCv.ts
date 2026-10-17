import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { CV } from '../../src/cv/types';

const require = createRequire(import.meta.url);

/** Minimal ImageData polyfill for Node: only data/width/height are relied upon. */
export function imageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

let cached: Promise<CV> | null = null;

/** Load @techstark/opencv-js and wait for its WASM runtime. */
export function loadCv(): Promise<CV> {
  if (!cached) {
    cached = new Promise<CV>((resolve) => {
      const cv: CV = require('@techstark/opencv-js');
      const done = () => {
        // The module object is a thenable; strip it so awaiting it doesn't recurse.
        delete cv.then;
        resolve(cv);
      };
      if (cv.Mat) done();
      else cv.onRuntimeInitialized = done;
    });
  }
  return cached;
}

export function readPng(path: string): ImageData {
  const png = PNG.sync.read(readFileSync(path));
  return imageData(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), png.width, png.height);
}

export function writePng(path: string, img: ImageData): void {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  writeFileSync(path, PNG.sync.write(png));
}

/** Downscale so the long side equals `longSide`; returns the image and the factor (out/in). */
export function downscale(cv: CV, img: ImageData, longSide: number): { img: ImageData; scale: number } {
  const scale = longSide / Math.max(img.width, img.height);
  const src = cv.matFromImageData(img);
  const dst = new cv.Mat();
  try {
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    cv.resize(src, dst, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    return { img: imageData(new Uint8ClampedArray(dst.data), w, h), scale };
  } finally {
    src.delete();
    dst.delete();
  }
}

/**
 * Track live cv.Mat / cv.MatVector instances: those built via the constructors, those returned
 * from any cv.* function, and those returned by Mat/MatVector instance methods (e.g.
 * `MatVector.get`, `Mat.clone`). Call `restore()` when done.
 */
export function trackMats(cv: CV): { live: () => number; restore: () => void } {
  const live = new Set<object>();
  const classes = ['Mat', 'MatVector'] as const;
  const origCtors: Record<string, CV> = {};
  const origDeletes: Record<string, CV> = {};
  for (const name of classes) {
    const Orig = cv[name];
    origCtors[name] = Orig;
    origDeletes[name] = Orig.prototype.delete;
    Orig.prototype.delete = function (this: object) {
      live.delete(this);
      return origDeletes[name].call(this);
    };
    cv[name] = new Proxy(Orig, {
      construct(target, args) {
        const m = Reflect.construct(target, args) as object;
        live.add(m);
        return m;
      },
    });
  }
  const isTracked = (v: unknown) => classes.some((n) => v instanceof origCtors[n]);
  const wrapped: Record<string, CV> = {};
  for (const key of Object.keys(cv)) {
    const fn = cv[key];
    if (typeof fn !== 'function' || !/^[a-z]/.test(key) || key === 'onRuntimeInitialized') continue;
    wrapped[key] = fn;
    const wrapper = function (this: unknown, ...args: unknown[]) {
      const r = fn.apply(this, args);
      if (isTracked(r)) live.add(r as object);
      return r;
    };
    // Embind overload dispatch reads `cv[key].overloadTable`; keep it reachable.
    if (fn.overloadTable) (wrapper as CV).overloadTable = fn.overloadTable;
    cv[key] = wrapper;
  }
  // Instance methods that may hand back a new Mat (MatVector.get, Mat.clone, Mat.roi, ...).
  const wrappedMethods: { proto: CV; key: string; fn: CV }[] = [];
  for (const name of classes) {
    const proto = origCtors[name].prototype;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || key === 'delete') continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (!desc || typeof desc.value !== 'function') continue; // skip getters (data, rows, ...)
      const fn = desc.value;
      const wrapper = function (this: unknown, ...args: unknown[]) {
        const r = fn.apply(this, args);
        if (isTracked(r)) live.add(r as object);
        return r;
      };
      if (fn.overloadTable) (wrapper as CV).overloadTable = fn.overloadTable;
      proto[key] = wrapper;
      wrappedMethods.push({ proto, key, fn });
    }
  }
  return {
    live: () => live.size,
    restore: () => {
      for (const { proto, key, fn } of wrappedMethods) proto[key] = fn;
      for (const name of classes) {
        origCtors[name].prototype.delete = origDeletes[name];
        cv[name] = origCtors[name];
      }
      for (const [k, fn] of Object.entries(wrapped)) cv[k] = fn;
    },
  };
}
