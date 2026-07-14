import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function viewportState(page: Page) {
  return page.evaluate(() =>
    (window as any).__scratchy.viewport.get() as { x: number; y: number; zoom: number },
  );
}

async function drawLine(page: Page, fx: number, fy: number, tx: number, ty: number) {
  const box = await page.locator('.stage-input').boundingBox();
  if (!box) throw new Error('stage not found');
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * tx, box.y + box.height * ty, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
});

test('zoom controls step, reset, and report the level', async ({ page }) => {
  await expect(page.locator('.zoom-readout')).toHaveText('100%');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.zoom-readout')).toHaveText('125%');
  expect((await viewportState(page)).zoom).toBeCloseTo(1.25, 5);

  await page.getByRole('button', { name: /Reset zoom/ }).click();
  await expect(page.locator('.zoom-readout')).toHaveText('100%');
  expect((await viewportState(page)).zoom).toBeCloseTo(1, 5);
});

test('zoom to fit brings distant strokes into view', async ({ page }) => {
  // Two strokes in opposite corners of a large world area.
  await drawLine(page, 0.1, 0.1, 0.2, 0.2);
  await page.evaluate(() => (window as any).__scratchy.viewport.panBy(-1500, -900));
  await drawLine(page, 0.7, 0.7, 0.9, 0.9);

  await page.getByRole('button', { name: /Zoom to fit/ }).click();

  const contained = await page.evaluate(() => {
    const { engine, viewport } = (window as any).__scratchy;
    const ink = engine.getInkBBox();
    const view = viewport.visibleWorldRect();
    return (
      ink.minX >= view.minX && ink.maxX <= view.maxX &&
      ink.minY >= view.minY && ink.maxY <= view.maxY
    );
  });
  expect(contained).toBe(true);
});

test('fit on an empty board shows a toast instead of moving', async ({ page }) => {
  const before = await viewportState(page);
  await page.getByRole('button', { name: /Zoom to fit/ }).click();
  await expect(page.locator('.toast')).toHaveText(/board is empty/);
  expect(await viewportState(page)).toEqual(before);
});

test('tapping the minimap recenters the viewport', async ({ page }) => {
  await drawLine(page, 0.4, 0.4, 0.6, 0.6);
  const before = await viewportState(page);

  const map = await page.locator('.minimap').boundingBox();
  if (!map) throw new Error('minimap not found');
  await page.mouse.click(map.x + map.width * 0.15, map.y + map.height * 0.15);

  const after = await viewportState(page);
  // Jumped up-left of where it was.
  expect(after.x).toBeLessThan(before.x);
  expect(after.y).toBeLessThan(before.y);
  expect(after.zoom).toBeCloseTo(before.zoom, 5);
});

test('keyboard: 1 fits ink, 0 resets zoom', async ({ page }) => {
  await drawLine(page, 0.4, 0.4, 0.6, 0.6);
  await page.evaluate(() => {
    const vp = (window as any).__scratchy.viewport;
    vp.set({ x: 4000, y: 4000, zoom: 3 });
  });
  await page.keyboard.press('1');
  const fitted = await viewportState(page);
  expect(fitted.x).toBeLessThan(4000);

  await page.keyboard.press('0');
  expect((await viewportState(page)).zoom).toBeCloseTo(1, 5);
});
