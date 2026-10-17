import type { Plugin } from 'vite';

/**
 * OpenCV.js (embind) builds a couple of helper functions with `new Function`, which a strict CSP
 * (no 'unsafe-eval') forbids. This rewrites those sites into closure-based equivalents.
 * Throws if an expected site is missing or any code generation remains, so an OpenCV upgrade
 * fails the build instead of failing at runtime.
 */

// createNamedFunction(name, body): wrapper named `name` forwarding `this` and all arguments to body.
const NAMED_FN_RE =
  /return new Function\("body","return function "\+name\+"\(\) \{\\n"\+'    "use strict";'\+"    return body\.apply\(this, arguments\);\\n"\+"\};\\n"\)\(body\)/;
const NAMED_FN_REPLACEMENT =
  'var __f=function(){return body.apply(this,arguments)};Object.defineProperty(__f,"name",{value:name,configurable:true});return __f';

// makeDynCaller(dynCall): function(a1..an){ return dynCall(rawFunction, a1..an) } named `name`.
const DYN_CALLER_RE = /return new Function\("dynCall","rawFunction",body\)\(dynCall,rawFunction\)/;
const DYN_CALLER_REPLACEMENT =
  'var __d=function(){var __a=[rawFunction];for(var __i=0;__i<arguments.length;++__i){__a.push(arguments[__i])}return dynCall.apply(undefined,__a)};' +
  'Object.defineProperty(__d,"name",{value:name,configurable:true});' +
  'Object.defineProperty(__d,"length",{value:args.length,configurable:true});return __d';


// craftInvokerFunction: generated wrapper that checks arity, wires args, calls the C++ invoker.
const CRAFT_INVOKER_RE = /var invokerFunction=new_\(Function,args1\)\.apply\(null,args2\);return invokerFunction/;
const CRAFT_INVOKER_REPLACEMENT = [
  'var __n=argCount-2;',
  'var __invoker=function(){',
  'if(arguments.length!==__n){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+__n+" args!")}',
  'var destructors=needsDestructorStack?[]:null;',
  'var __w=[];var thisWired;',
  'if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this);__w.push(thisWired)}',
  'for(var __i=0;__i<__n;++__i){__w.push(argTypes[__i+2].toWireType(destructors,arguments[__i]))}',
  'var rv=cppInvokerFunc.apply(undefined,[cppTargetFunc].concat(__w));',
  'if(needsDestructorStack){runDestructors(destructors)}else{',
  'for(var __j=isClassMethodFunc?1:2;__j<argTypes.length;++__j){',
  'var __dtor=argTypes[__j].destructorFunction;',
  'if(__dtor!==null){__dtor(__j===1?thisWired:__w[(isClassMethodFunc?1:0)+__j-2])}}}',
  'if(returns){return argTypes[0].fromWireType(rv)}',
  '};',
  'Object.defineProperty(__invoker,"name",{value:makeLegalFunctionName(humanName),configurable:true});',
  'Object.defineProperty(__invoker,"length",{value:__n,configurable:true});',
  'return __invoker',
].join('');

// __emval_get_method_caller: generated wrapper reading args from memory and calling handle[name](...).
const METHOD_CALLER_RE = /var invokerFunction=new_\(Function,params\)\.apply\(null,args\);return __emval_addMethodCaller\(invokerFunction\)/;
const METHOD_CALLER_REPLACEMENT = [
  'var __caller=function(handle,name,destructors,args){',
  'var __a=[];var __off=0;',
  'for(var __i=0;__i<argCount-1;++__i){__a.push(types[__i+1].readValueFromPointer(__off?args+__off:args));__off+=types[__i+1]["argPackAdvance"]}',
  'var rv=handle[name].apply(handle,__a);',
  'for(var __i=0;__i<argCount-1;++__i){if(types[__i+1]["deleteObject"]){types[__i+1].deleteObject(__a[__i])}}',
  'if(!retType.isVoid){return retType.toWireType(destructors,rv)}',
  '};',
  'Object.defineProperty(__caller,"name",{value:functionName,configurable:true});',
  'return __emval_addMethodCaller(__caller)',
].join('');

const REMAINING_RE = /\bnew_\s*\(\s*Function\b|\bnew\s+Function\s*\(|(?<![\w$.])Function\s*\(|(?<![\w$.])eval\s*\(/;

const MARKER = '/*opencvNoEval:patched*/';

export function patchOpenCvSource(src: string): string {
  let out = src;
  for (const [label, re, rep] of [
    ['createNamedFunction', NAMED_FN_RE, NAMED_FN_REPLACEMENT],
    ['makeDynCaller', DYN_CALLER_RE, DYN_CALLER_REPLACEMENT],
    ['craftInvokerFunction', CRAFT_INVOKER_RE, CRAFT_INVOKER_REPLACEMENT],
    ['__emval_get_method_caller', METHOD_CALLER_RE, METHOD_CALLER_REPLACEMENT],
  ] as const) {
    if (!re.test(out)) {
      throw new Error(`opencvNoEval: expected embind code-generation site "${label}" not found; OpenCV changed, update build/opencvNoEval.ts`);
    }
    out = out.replace(re, () => rep);
  }
  const m = REMAINING_RE.exec(out);
  if (m) {
    const at = m.index;
    throw new Error(`opencvNoEval: code generation remains after patching: ...${out.slice(Math.max(0, at - 60), at + 120)}...`);
  }
  return MARKER + out;
}

const OPENCV_RE = /[\\/]@techstark[\\/]opencv-js[\\/]dist[\\/]opencv\.js$/;

/** True for the real opencv.js file (any `?query` ignored); false for `\0` virtual modules. */
export function isOpenCvId(id: string): boolean {
  if (id.startsWith('\0')) return false; // virtual variants (e.g. commonjs-module proxies)
  return OPENCV_RE.test(id.split('?')[0]);
}

/**
 * Chunk scan for generateBundle: a chunk that contains OpenCV (its embind runtime) must be free of
 * code generation. Returns an error message, or null when fine / not an OpenCV chunk.
 */
export function checkChunk(fileName: string, code: string): string | null {
  if (!code.includes('embind')) return null; // not an OpenCV chunk
  const m = REMAINING_RE.exec(code);
  if (!m) return null;
  return `opencvNoEval: chunk ${fileName} still contains code generation: ...${code.slice(Math.max(0, m.index - 60), m.index + 120)}...`;
}

export function opencvNoEval(): Plugin {
  return {
    name: 'opencv-no-eval',
    enforce: 'pre',
    transform(code, id) {
      if (!isOpenCvId(id)) return null;
      if (code.startsWith(MARKER)) return null; // already patched (transform can run more than once per module)
      return { code: patchOpenCvSource(code), map: null };
    },
    generateBundle(_opts, bundle) {
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const err = checkChunk(name, chunk.code);
        if (err) this.error(err);
      }
    },
  };
}
/** Same patch for esbuild-based dev dependency pre-bundling. */
export const opencvNoEvalEsbuild = {
  name: 'opencv-no-eval',
  setup(build: { onLoad: (o: { filter: RegExp }, cb: (a: { path: string }) => Promise<{ contents: string; loader: 'js' }>) => void }) {
    build.onLoad({ filter: OPENCV_RE }, async (args) => {
      const { readFile } = await import('node:fs/promises');
      return { contents: patchOpenCvSource(await readFile(args.path, 'utf8')), loader: 'js' };
    });
  },
};
