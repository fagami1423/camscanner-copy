import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import type { Quad } from '../../src/types';
import type { CV } from '../../src/cv/types';
import { scaleQuad } from '../../src/cv/geometry';
import { detectQuad } from '../../src/cv/detect';
import { patchOpenCvSource, isOpenCvId, checkChunk } from '../../build/opencvNoEval';
import { downscale, readPng } from './loadCv';

const require = createRequire(import.meta.url);
const OPENCV = require.resolve('@techstark/opencv-js/dist/opencv.js');
const FIX = join(__dirname, '..', 'fixtures');
const truth: { file: string; quad: Quad | null }[] = JSON.parse(readFileSync(join(FIX, 'truth.json'), 'utf8'));

/** Load an opencv.js source in a context that forbids string code generation (mirrors the CSP). */
function loadInNoEvalContext(src: string): Promise<CV> {
  const sandbox: Record<string, unknown> = {
    module: { exports: {} },
    console,
    WebAssembly,
    TextDecoder,
    setTimeout,
    clearTimeout,
    performance,
    URL,
    importScripts: () => {}, // emulate a web worker, like the real deployment
    location: { href: 'http://localhost/worker.js' },
  };
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: true } });
  vm.runInContext(src, ctx, { filename: 'opencv.js' });
  const cv = (sandbox.module as { exports: CV }).exports;
  return new Promise<CV>((resolve) => {
    const done = () => {
      delete cv.then;
      resolve(cv);
    };
    if (cv.Mat) done();
    else cv.onRuntimeInitialized = done;
  });
}

const raw = readFileSync(OPENCV, 'utf8');

describe('opencvNoEval', () => {
  it('unpatched OpenCV cannot initialise without eval (guards that the context mirrors the CSP)', async () => {
    let err: unknown;
    try {
      await loadInNoEvalContext(raw);
    } catch (e) {
      err = e;
    }
    expect(String(err)).toMatch(/EvalError|Code generation from strings disallowed/);
  });

  it('patched source has no code generation', () => {
    const patched = patchOpenCvSource(raw);
    expect(patched).not.toMatch(/new\s+Function\s*\(/);
    expect(patched).not.toMatch(/(?<![\w$.])Function\s*\(/);
    expect(patched).not.toMatch(/(?<![\w$.])eval\s*\(/);
  });

  it('patched OpenCV runs detectQuad on dark-desk within 2% of truth, with eval disabled', async () => {
    const cv = await loadInNoEvalContext(patchOpenCvSource(raw));
    const { quad } = truth.find((t) => t.file === 'dark-desk.png')!;
    const full = readPng(join(FIX, 'generated', 'dark-desk.png'));
    const { img, scale } = downscale(cv, full, 480);
    const q = detectQuad(cv, img);
    expect(q).not.toBeNull();
    const back = scaleQuad(q!, 1 / scale);
    const diag = Math.hypot(full.width, full.height);
    for (let i = 0; i < 4; i++) {
      expect(Math.hypot(back[i].x - quad![i].x, back[i].y - quad![i].y) / diag).toBeLessThan(0.02);
    }
  }, 60000);

  it('patchOpenCvSource throws when expected patterns are missing or code generation remains', () => {
    expect(() => patchOpenCvSource('var x = 1;')).toThrow(/not found/);
    const patched = patchOpenCvSource(raw);
    expect(() => patchOpenCvSource(patched)).toThrow(/not found/);
    const extra = raw + '\nvar z = new Function("return 1");';
    expect(() => patchOpenCvSource(extra)).toThrow(/code generation remains/);
  });
});

describe('opencvNoEval plugin helpers', () => {
  it('isOpenCvId ignores queries, rejects virtual ids', () => {
    const p = '/x/node_modules/@techstark/opencv-js/dist/opencv.js';
    expect(isOpenCvId(p)).toBe(true);
    expect(isOpenCvId(p + '?v=abc')).toBe(true);
    expect(isOpenCvId('\0' + p + '?commonjs-module')).toBe(false);
    expect(isOpenCvId('/x/other.js')).toBe(false);
  });

  it('checkChunk flags code generation only in OpenCV chunks', () => {
    expect(checkChunk('a.js', 'var embind=1;var f=new Function("return 1")')).toMatch(/still contains code generation/);
    expect(checkChunk('a.js', 'var embind=1;eval("1")')).toMatch(/still contains/);
    expect(checkChunk('a.js', 'var embind=1;var f=function(){}')).toBeNull();
    expect(checkChunk('app.js', 'var f=new Function("return 1")')).toBeNull();
  });

  it('checkChunk on the real patched source passes and on the raw source fails', () => {
    expect(checkChunk('o.js', patchOpenCvSource(raw))).toBeNull();
    expect(checkChunk('o.js', raw)).toMatch(/still contains/);
  });
});
