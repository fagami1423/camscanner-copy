import * as Comlink from 'comlink';
// Static import: a dynamic import() of this CommonJS module resolves to the cv object, which is a
// thenable (Module.then), so the promise would adopt it and never settle.
import cvModule from '@techstark/opencv-js';
import type { FilterMode, Quad } from '../types';
import type { CV } from './types';
import type { CvApi } from './client';
import { detectQuad } from './detect';
import { warp, enhance } from './process';

let cvPromise: Promise<CV> | null = null;

function loadCv(): Promise<CV> {
  if (!cvPromise) {
    cvPromise = new Promise<CV>((resolve, reject) => {
      const cv: CV = cvModule;
      // Emscripten abort (e.g. wasm instantiation failure) never fires onRuntimeInitialized.
      cv.onAbort = (what: unknown) => reject(new Error(`OpenCV aborted: ${String(what)}`));
      const done = () => {
        // The module object is a thenable; strip it so resolving with it doesn't recurse.
        delete cv.then;
        resolve(cv);
      };
      if (cv.Mat) done();
      else cv.onRuntimeInitialized = done;
    });
  }
  return cvPromise;
}

function out(img: ImageData) {
  return Comlink.transfer(img, [img.data.buffer]);
}

const api: CvApi = {
  async ready() {
    await loadCv();
  },
  async detect(img: ImageData) {
    return detectQuad(await loadCv(), img);
  },
  async warp(img: ImageData, q: Quad) {
    return out(warp(await loadCv(), img, q));
  },
  async enhance(img: ImageData, mode: FilterMode) {
    return out(enhance(await loadCv(), img, mode));
  },
};

Comlink.expose(api);
