import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type Page, type Request } from '@playwright/test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GENERATED_DIR } from '../fixtures/generate';

export const fixture = (name: string) => join(GENERATED_DIR, name);

/**
 * `test` that records every request issued in the browser context and, after the test, asserts each
 * URL is same-origin with the app. Coverage: pages, dedicated workers and the service worker. With
 * the installed Playwright (1.64, Chromium) service-worker network events are on by default (the old
 * PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS flag no longer exists; PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK
 * opts out), so SW precache fetches arrive here with `request.serviceWorker()` set; offline.spec.ts
 * asserts that.
 */
export const test = base.extend<{ requests: Request[] }>({
  requests: async ({ context, baseURL }, use) => {
    const reqs: Request[] = [];
    context.on('request', (r) => reqs.push(r));
    await use(reqs);
    const urls = reqs.map((r) => r.url());
    if (process.env.E2E_LOG_REQUESTS) {
      console.log([...new Set(reqs.map((r) => `${r.serviceWorker() ? '[sw] ' : ''}${r.url()}`))].join('\n'));
    }
    const appOrigin = new URL(baseURL!).origin;
    expect(urls.length, 'some requests were recorded').toBeGreaterThan(0);
    // data: URLs are inline payloads, not network traffic; blob: URLs carry the creating origin.
    const offOrigin = urls.filter((u) => !u.startsWith('data:') && new URL(u).origin !== appOrigin);
    expect(offOrigin, 'requests to other origins').toEqual([]);
  },
});

/** Force the download fallback for exports: no Web Share. */
export async function stubNoShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
  });
}

/** Click "Export PDF", capture the download and parse it with pdfjs. */
export async function exportPdf(page: Page): Promise<{ pages: number; text: string }> {
  const download = page.waitForEvent('download', { timeout: 150_000 });
  await page.getByRole('button', { name: 'Export PDF' }).click();
  // If OCR is still running, the wait dialog exports with text automatically once it finishes.
  const bytes = new Uint8Array(await readFile(await (await download).path()));
  const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true, verbosity: 0 } as never).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  return { pages: doc.numPages, text: text.replace(/\s+/g, ' ') };
}

export { expect };
