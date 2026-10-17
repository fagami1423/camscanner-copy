import type { Plugin } from 'vite';
import { CSP } from '../csp';

/**
 * `_headers` file (Netlify / Cloudflare Pages format) applying the CSP as a response header to every
 * path. A header, unlike the page's <meta> CSP, also governs dedicated workers and the service worker.
 */
export function headersFile(csp: string): string {
  return `/*\n  Content-Security-Policy: ${csp}\n`;
}

/** Emits `_headers` into the build output, generated from csp.ts so it cannot drift. */
export function cspHeadersPlugin(): Plugin {
  return {
    name: 'csp-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(CSP) });
    },
  };
}
