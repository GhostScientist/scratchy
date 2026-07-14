import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Width/height from the PNG IHDR chunk (big-endian at offsets 16/20). */
function pngSize(path: string): { w: number; h: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');
});

test('export current view produces a 2x stage PNG', async ({ page }, testInfo) => {
  const box = await page.locator('.stage-input').boundingBox();
  if (!box) throw new Error('stage not found');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();

  await page.locator('.title-input').fill('Fractions 101');
  await page.getByRole('button', { name: 'Export image' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Current view (PNG)' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('fractions-101.png');
  const path = testInfo.outputPath('view.png');
  await download.saveAs(path);
  expect(pngSize(path)).toEqual({ w: 2560, h: 1440 });
});

test('export whole board captures ink outside the current view', async ({ page }, testInfo) => {
  const box = await page.locator('.stage-input').boundingBox();
  if (!box) throw new Error('stage not found');
  // Ink in two far-apart world regions.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => (window as any).__scratchy.viewport.panBy(-2000, 0));
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Export image' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Whole board (PNG)' }).click();
  const download = await downloadPromise;

  const path = testInfo.outputPath('board.png');
  await download.saveAs(path);
  const { w, h } = pngSize(path);
  // Ink spans ~2500+ world px horizontally; the export is clamped to 4096.
  expect(w).toBeGreaterThan(2000);
  expect(w).toBeLessThanOrEqual(4096);
  expect(h).toBeGreaterThan(0);
  expect(h).toBeLessThanOrEqual(4096);
});

test('whole-board export on an empty board shows a toast', async ({ page }) => {
  await page.getByRole('button', { name: 'Export image' }).click();
  await page.getByRole('button', { name: 'Whole board (PNG)' }).click();
  await expect(page.locator('.toast')).toHaveText(/Nothing to export/);
});
