import { expect, exportPdf, fixture, stubNoShare, test } from './helpers';

test.beforeEach(async ({ page, requests }) => {
  void requests; // start recording before navigation
  await stubNoShare(page);
});

test('auto-capture from camera, crop, B&W filter, searchable PDF export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New scan' }).click();

  const counter = page.locator('.page-count');
  await expect(counter).toHaveText('0 pages');
  // OpenCV init in the worker can take a while; auto-capture is timed from when the scanner is ready.
  await expect(page.getByText('Loading scanner…')).toBeHidden({ timeout: 60_000 });

  // No shutter click: the still page in the fake camera must trigger auto-capture.
  await expect(counter).toHaveText(/^(1 page|0 pages \(\+1 saving\))/, { timeout: 10_000 });
  await expect(counter).toHaveText('1 page', { timeout: 30_000 });
  // The page stays in view and steady: auto-capture is disarmed after firing, so no duplicate
  // appears even well past the 1.5 s cooldown.
  await page.waitForTimeout(4_000);
  await expect(counter).toHaveText('1 page');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Edit page 1' }).click();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await page.getByRole('radio', { name: 'B&W filter' }).click();
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled({ timeout: 30_000 });

  const { pages, text } = await exportPdf(page);
  expect(pages).toBe(1);
  expect(text).toContain('INVOICE 2026');
});

test('gallery import honours EXIF orientation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New scan' }).click();
  // The fake camera is live here too; keep it from adding pages.
  await page.getByRole('checkbox', { name: 'Auto' }).uncheck();

  await page.getByLabel('Import images').setInputFiles(fixture('rotated.jpg'));
  await expect(page.locator('.page-count')).toHaveText('1 page', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  const thumb = page.getByRole('img', { name: 'Page 1' });
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const { w, h } = await thumb.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }));
  expect(h).toBeGreaterThan(w);
});

test('Cancel and system Back leave the camera; an empty scan is discarded', async ({ page }) => {
  await page.goto('/');
  const empty = page.getByText('No scans yet.', { exact: false });
  await expect(empty).toBeVisible();

  await page.getByRole('button', { name: 'New scan' }).click();
  await page.getByRole('checkbox', { name: 'Auto' }).uncheck();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Scans' })).toBeVisible();
  await expect(empty).toBeVisible();

  await page.getByRole('button', { name: 'New scan' }).click();
  await page.getByRole('checkbox', { name: 'Auto' }).uncheck(); // a capture would (rightly) keep the scan
  await page.goBack(); // system Back returns to the library instead of leaving the app
  await expect(page.getByRole('heading', { name: 'Scans' })).toBeVisible();
  await expect(empty).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});
