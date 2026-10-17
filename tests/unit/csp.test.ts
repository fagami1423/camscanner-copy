import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSP } from '../../csp';

const EXPECTED =
  "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";

describe('CSP', () => {
  it('equals the global constraint string', () => {
    expect(CSP).toBe(EXPECTED);
  });
  it('is present in index.html meta tag', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
  });
});

describe('vite config headers', () => {
  it('sets CSP on dev server and preview', async () => {
    const mod = await import('../../vite.config');
    const cfg = mod.default as { server: { headers: Record<string, string> }; preview: { headers: Record<string, string> } };
    expect(cfg.server.headers['Content-Security-Policy']).toBe(CSP);
    expect(cfg.preview.headers['Content-Security-Policy']).toBe(CSP);
  });
});
