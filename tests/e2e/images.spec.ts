import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A 400×300 PNG generated in the browser (no fixture files needed). */
async function pngBuffer(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(50, 50, 300, 200);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function importPng(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'diagram.png',
    mimeType: 'image/png',
    buffer: await pngBuffer(page),
  });
  await page.waitForFunction(() =>
    (window as any).__scratchy.engine.getElements().some((el: any) => el.kind === 'image'),
  );
}

function getImage(page: Page) {
  return page.evaluate(() => ({
    ...(window as any).__scratchy.engine.getElements().find((el: any) => el.kind === 'image'),
  }));
}

/** Client coordinates of a world point (through viewport + stage scaling). */
async function worldToClient(page: Page, wx: number, wy: number) {
  const stage = await page.evaluate((p) => (window as any).__scratchy.viewport.worldToStage(p), {
    x: wx,
    y: wy,
  });
  const box = await page.locator('.stage-input').boundingBox();
  if (!box) throw new Error('stage not found');
  return {
    x: box.x + (stage.x * box.width) / 1280,
    y: box.y + (stage.y * box.height) / 720,
  };
}

async function dragClient(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');
});

test('imported image is placed, movable, resizable, and undoable', async ({ page }) => {
  await importPng(page);
  const img = await getImage(page);
  expect(img.w).toBeGreaterThan(0);
  expect(Math.abs(img.w / img.h - 400 / 300)).toBeLessThan(0.01);

  // Select + drag moves it.
  await page.keyboard.press('s');
  const center = await worldToClient(page, img.x + img.w / 2, img.y + img.h / 2);
  await dragClient(page, center, { x: center.x + 90, y: center.y + 40 });
  const moved = await getImage(page);
  expect(moved.x).toBeGreaterThan(img.x + 10);
  expect(moved.y).toBeGreaterThan(img.y + 5);

  // Corner drag resizes, preserving aspect.
  const corner = await worldToClient(page, moved.x + moved.w, moved.y + moved.h);
  await dragClient(page, corner, { x: corner.x + 80, y: corner.y + 80 });
  const resized = await getImage(page);
  expect(resized.w).toBeGreaterThan(moved.w + 10);
  expect(Math.abs(resized.w / resized.h - moved.w / moved.h)).toBeLessThan(0.01);
  // The opposite corner stayed anchored.
  expect(resized.x).toBeCloseTo(moved.x, 0);
  expect(resized.y).toBeCloseTo(moved.y, 0);

  // Undo unwinds resize, then move.
  await page.keyboard.press('z');
  expect((await getImage(page)).w).toBeCloseTo(moved.w, 0);
  await page.keyboard.press('z');
  expect((await getImage(page)).x).toBeCloseTo(img.x, 0);
});

test('locked image ignores erase and move but takes annotations', async ({ page }) => {
  await importPng(page);
  const img = await getImage(page);
  const center = await worldToClient(page, img.x + img.w / 2, img.y + img.h / 2);

  // Select it, then lock via the floating action.
  await page.keyboard.press('s');
  await page.mouse.click(center.x, center.y);
  await page.getByRole('button', { name: 'Lock image' }).click();
  expect((await getImage(page)).locked).toBe(true);

  // Eraser swipe across it: the image survives.
  await page.keyboard.press('e');
  await dragClient(
    page,
    { x: center.x - 60, y: center.y },
    { x: center.x + 60, y: center.y },
  );
  expect((await getImage(page)).kind).toBe('image');

  // Select-drag across it: it does not move (the gesture lassos instead).
  await page.keyboard.press('s');
  await dragClient(page, center, { x: center.x + 80, y: center.y + 40 });
  expect((await getImage(page)).x).toBeCloseTo(img.x, 0);

  // Ink lands on top of it.
  await page.keyboard.press('p');
  await dragClient(
    page,
    { x: center.x - 40, y: center.y - 20 },
    { x: center.x + 40, y: center.y + 20 },
  );
  const kinds = await page.evaluate(() =>
    (window as any).__scratchy.engine.getElements().map((el: any) => el.kind),
  );
  expect(kinds.filter((k: string) => k === 'stroke')).toHaveLength(1);

  // A tap re-selects the locked image (off the fresh stroke, which would win
  // the hit test); unlock makes it erasable again.
  await page.keyboard.press('s');
  const offStroke = await worldToClient(page, img.x + img.w / 2, img.y + img.h * 0.15);
  await page.mouse.click(offStroke.x, offStroke.y);
  await page.getByRole('button', { name: 'Unlock image' }).click();
  expect((await getImage(page)).locked).toBe(false);
  await page.keyboard.press('e');
  await dragClient(
    page,
    { x: center.x - 60, y: center.y },
    { x: center.x + 60, y: center.y },
  );
  const remaining = await page.evaluate(() =>
    (window as any).__scratchy.engine.getElements().filter((el: any) => el.kind === 'image'),
  );
  expect(remaining).toHaveLength(0);
});

test('image and its asset survive a reload', async ({ page }) => {
  await importPng(page);
  const img = await getImage(page);

  await page.waitForTimeout(900); // debounced autosave
  await page.reload();
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');

  const restored = await getImage(page);
  expect(restored.assetId).toBe(img.assetId);
  expect(restored.w).toBeCloseTo(img.w, 1);

  const asset = await page.evaluate(
    (id) => (window as any).__scratchyAssets.getAsset(id),
    img.assetId,
  );
  expect(asset).not.toBeNull();
  expect(asset.mime).toBe('image/png');
  expect(asset.width).toBe(400);
});
