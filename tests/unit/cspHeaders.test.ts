import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSP } from '../../csp';
import { cspHeadersPlugin, headersFile } from '../../build/cspHeaders';

describe('_headers (Netlify / Cloudflare Pages)', () => {
  it('applies the exact CSP to every path', () => {
    const text = headersFile(CSP);
    expect(text).toBe(`/*\n  Content-Security-Policy: ${CSP}\n`);
    expect(text.split('\n')[1]).toBe(`  Content-Security-Policy: ${CSP}`);
  });

  it('the build plugin emits _headers generated from CSP', () => {
    const emitted: { type: string; fileName: string; source: string }[] = [];
    const plugin = cspHeadersPlugin();
    (plugin.generateBundle as (this: unknown) => void).call({ emitFile: (f: (typeof emitted)[number]) => emitted.push(f) });
    expect(emitted).toEqual([{ type: 'asset', fileName: '_headers', source: headersFile(CSP) }]);
  });

  it('is registered in the Vite config', async () => {
    const cfg = (await import('../../vite.config')).default as { plugins: unknown[] };
    const names = cfg.plugins.flat(Infinity).map((p) => (p as { name?: string } | null)?.name);
    expect(names).toContain('csp-headers');
  });

  it('docs/deploy.md nginx snippet carries the same CSP', () => {
    expect(readFileSync('docs/deploy.md', 'utf8')).toContain(`add_header Content-Security-Policy "${CSP}" always;`);
  });
});
