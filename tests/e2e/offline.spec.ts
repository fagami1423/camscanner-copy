import type { Response } from '@playwright/test';
import { expect, exportPdf, fixture, stubNoShare, test } from './helpers';

test('works fully offline (CV and first-ever OCR) once the SW has precached the app', async ({ page, context, requests }) => {
  await stubNoShare(page);
  // Fresh context: Tesseract has never run for this origin, so its IndexedDB language cache is empty,
  // and nothing in the online phase below triggers OCR.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New scan' })).toBeVisible();
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('keyval-store');

  // Wait for the SW to be active (install = precache done) and controlling this page (clientsClaim).
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
  // The SW's own precache fetches were observed (proves SW network events are recorded).
  expect(requests.filter((r) => r.serviceWorker() !== null).map((r) => new URL(r.url()).pathname)).toEqual(
    expect.arrayContaining(['/index.html', '/vendor/tesseract/lang/eng.traineddata.gz']),
  );

  await context.setOffline(true);
  const tessResponses: Response[] = [];
  context.on('response', (r) => {
    if (!r.request().serviceWorker() && new URL(r.url()).pathname.startsWith('/vendor/tesseract/')) tessResponses.push(r);
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Scans' })).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await page.getByRole('button', { name: 'New scan' }).click();
  await page.getByRole('checkbox', { name: 'Auto' }).uncheck();
  await page.waitForTimeout(10_000);
  await expect(page.getByText('Loading scanner…')).toBeHidden();
  await expect(page.getByText(/Scanner engine failed to load/)).toBeHidden();

  // Import a photo (CV worker from cache), let OCR run for the first time offline, export a searchable PDF.
  await page.getByLabel('Import images').setInputFiles(fixture('dark-desk.png'));
  await expect(page.locator('.page-count')).toHaveText('1 page', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible();
  await expect(page.locator('[data-ocr]')).toHaveAttribute('data-ocr', 'done', { timeout: 120_000 });

  const { pages, text } = await exportPdf(page);
  expect(pages).toBe(1);
  expect(text).toContain('INVOICE 2026');

  // Tesseract's worker script, a core and the language data were all served by the SW while offline.
  const paths = tessResponses.map((r) => new URL(r.url()).pathname);
  expect(paths).toEqual(
    expect.arrayContaining([
      '/vendor/tesseract/worker.min.js',
      expect.stringMatching(/^\/vendor\/tesseract\/tesseract-core-(simd-)?lstm\.wasm\.js$/),
      '/vendor/tesseract/lang/eng.traineddata.gz',
    ]),
  );
  for (const r of tessResponses) {
    expect.soft(r.status(), r.url()).toBe(200);
    expect.soft(r.fromServiceWorker(), r.url()).toBe(true);
  }
});
