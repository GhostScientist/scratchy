import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function strokeCount(page: Page) {
  return page.evaluate(() => (window as any).__scratchy.engine.getStrokes().length);
}

async function pagesInfo(page: Page) {
  return page.evaluate(() => (window as any).__scratchyPages.info());
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
  await page.waitForSelector('.boards-menu');
});

test('pages keep separate content and flip via keys and strip', async ({ page }) => {
  await drawLine(page, 0.3, 0.3, 0.5, 0.5);
  expect(await strokeCount(page)).toBe(1);

  // Add a page: it opens blank after the current one.
  await page.getByRole('button', { name: 'Add page' }).click();
  expect(await pagesInfo(page)).toMatchObject({ count: 2, activeIndex: 1 });
  expect(await strokeCount(page)).toBe(0);

  await drawLine(page, 0.4, 0.4, 0.6, 0.6);
  await drawLine(page, 0.4, 0.6, 0.6, 0.4);
  expect(await strokeCount(page)).toBe(2);

  // PageUp flips back to page 1 with its own content.
  await page.keyboard.press('PageUp');
  expect(await pagesInfo(page)).toMatchObject({ activeIndex: 0 });
  expect(await strokeCount(page)).toBe(1);

  // PageDown returns; past the last page it is a no-op.
  await page.keyboard.press('PageDown');
  expect(await strokeCount(page)).toBe(2);
  await page.keyboard.press('PageDown');
  expect(await pagesInfo(page)).toMatchObject({ activeIndex: 1 });

  // Strip tabs open pages directly.
  await page.getByRole('tab', { name: 'Page 1 of 2' }).click();
  expect(await strokeCount(page)).toBe(1);
});

test('pages, active page, and per-page viewport survive reload', async ({ page }) => {
  await drawLine(page, 0.3, 0.3, 0.5, 0.5);
  await page.getByRole('button', { name: 'Add page' }).click();
  await drawLine(page, 0.4, 0.4, 0.6, 0.6);
  // Give page 2 a distinctive viewport.
  await page.evaluate(() => {
    (window as any).__scratchy.viewport.set({ x: 40, y: 30, zoom: 2 });
  });

  await page.waitForTimeout(900); // debounced autosave
  await page.reload();
  await page.waitForFunction(() => (window as any).__scratchyPages !== undefined);
  await page.waitForSelector('.page-strip');

  expect(await pagesInfo(page)).toMatchObject({ count: 2, activeIndex: 1 });
  expect(await strokeCount(page)).toBe(1);
  const viewport = await page.evaluate(() => (window as any).__scratchy.viewport.get());
  expect(viewport.zoom).toBeCloseTo(2, 5);
  expect(viewport.x).toBeCloseTo(40, 5);

  // Page 1 kept its own content and default viewport.
  await page.keyboard.press('PageUp');
  expect(await strokeCount(page)).toBe(1);
  const vp1 = await page.evaluate(() => (window as any).__scratchy.viewport.get());
  expect(vp1.zoom).toBeCloseTo(1, 5);
});

test('duplicate, reorder, and delete pages', async ({ page }) => {
  await drawLine(page, 0.3, 0.3, 0.5, 0.5);

  // Duplicate copies content under fresh element ids.
  const originalId = await page.evaluate(
    () => (window as any).__scratchy.engine.getStrokes()[0].id,
  );
  await page.getByRole('button', { name: 'Duplicate page' }).click();
  expect(await pagesInfo(page)).toMatchObject({ count: 2, activeIndex: 1 });
  expect(await strokeCount(page)).toBe(1);
  const copyId = await page.evaluate(() => (window as any).__scratchy.engine.getStrokes()[0].id);
  expect(copyId).not.toBe(originalId);

  // Reorder: move the duplicate (active, index 1) left.
  const idsBefore = (await pagesInfo(page)).ids;
  await page.getByRole('button', { name: 'Move page left' }).click();
  const after = await pagesInfo(page);
  expect(after.activeIndex).toBe(0);
  expect(after.ids).toEqual([idsBefore[1], idsBefore[0]]);

  // Delete the active page (two-tap confirm) — falls to the neighbor.
  await page.getByRole('button', { name: 'Delete page' }).click();
  await page.getByRole('button', { name: 'Confirm delete page' }).click();
  expect(await pagesInfo(page)).toMatchObject({ count: 1, activeIndex: 0 });

  // Deleting the last page leaves one blank page.
  await page.getByRole('button', { name: 'Delete page' }).click();
  await page.getByRole('button', { name: 'Confirm delete page' }).click();
  expect(await pagesInfo(page)).toMatchObject({ count: 1 });
  expect(await strokeCount(page)).toBe(0);
});

test('v4 single-canvas board migrates to one page', async ({ page }) => {
  await page.evaluate(async () => {
    const open = indexedDB.open('scratchy');
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const record = {
      version: 4,
      id: 'b-legacy',
      title: 'Legacy lesson',
      background: 'grid',
      tool: 'pen',
      color: '#1d1f24',
      width: 4,
      cameraLayout: { x: 10, y: 10, width: 300, height: 169, shape: 'rounded', mirrored: true },
      viewport: { x: 12, y: 34, zoom: 1.5 },
      strokes: [
        {
          kind: 'stroke',
          id: 's-legacy',
          tool: 'pen',
          color: '#1d1f24',
          baseWidth: 4,
          opacity: 1,
          simulatePressure: true,
          points: [
            { x: 100, y: 100, pressure: 0.5 },
            { x: 200, y: 180, pressure: 0.5 },
          ],
        },
      ],
      updatedAt: Date.now() + 60_000, // newest, so it opens as active
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['boards', 'meta'], 'readwrite');
      tx.objectStore('boards').put(record);
      tx.objectStore('meta').put('b-legacy', 'activeBoardId');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.reload();
  await page.waitForFunction(() => (window as any).__scratchyPages !== undefined);
  await page.waitForSelector('.page-strip');

  await expect(page.locator('.title-input')).toHaveValue('Legacy lesson');
  expect(await pagesInfo(page)).toMatchObject({ count: 1, activeIndex: 0 });
  expect(await strokeCount(page)).toBe(1);
  // The old flat viewport became the page viewport.
  const viewport = await page.evaluate(() => (window as any).__scratchy.viewport.get());
  expect(viewport.zoom).toBeCloseTo(1.5, 5);
  expect(viewport.x).toBeCloseTo(12, 5);
});
