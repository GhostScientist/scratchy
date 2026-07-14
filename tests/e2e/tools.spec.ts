import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');
});

function elements(page: Page) {
  return page.evaluate(() =>
    ((window as any).__scratchy.engine.getElements() as { kind: string }[]).map((el) => ({
      ...el,
    })),
  );
}

async function stageBox(page: Page) {
  const box = await page.locator('.stage-input').boundingBox();
  if (!box) throw new Error('stage not found');
  return box;
}

async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 12 });
  await page.mouse.up();
}

test('shape tool drags out a rectangle, undo removes it', async ({ page }) => {
  await page.keyboard.press('r');
  const box = await stageBox(page);
  await drag(
    page,
    box.x + box.width * 0.3,
    box.y + box.height * 0.3,
    box.x + box.width * 0.5,
    box.y + box.height * 0.5,
  );

  let els = await elements(page);
  expect(els).toHaveLength(1);
  const shape = els[0] as any;
  expect(shape.kind).toBe('shape');
  expect(shape.shape).toBe('rect');
  expect(shape.w).toBeGreaterThan(50);
  expect(shape.h).toBeGreaterThan(50);

  await page.keyboard.press('z');
  els = await elements(page);
  expect(els).toHaveLength(0);
  await page.keyboard.press('Shift+Z');
  expect(await elements(page)).toHaveLength(1);
});

test('text tool opens an editor and commits a text element', async ({ page }) => {
  await page.keyboard.press('t');
  const box = await stageBox(page);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);

  const editor = page.locator('.text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Hello board');
  // Blur commits.
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);

  const els = await elements(page);
  const texts = els.filter((el) => el.kind === 'text') as any[];
  expect(texts).toHaveLength(1);
  expect(texts[0].text).toBe('Hello board');

  // Tap the element again to edit it; Escape cancels without changes.
  await page.mouse.click(box.x + box.width * 0.41, box.y + box.height * 0.41);
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  expect(((await elements(page)).find((el) => el.kind === 'text') as any).text).toBe(
    'Hello board',
  );
});

test('lasso selects one of two strokes and drags it; undo restores', async ({ page }) => {
  const box = await stageBox(page);
  const y = box.y + box.height * 0.5;
  // Two horizontal pen strokes, left and right.
  await drag(page, box.x + box.width * 0.15, y, box.x + box.width * 0.25, y);
  await drag(page, box.x + box.width * 0.65, y, box.x + box.width * 0.75, y);
  expect(await elements(page)).toHaveLength(2);

  const before = (await elements(page)) as any[];
  const leftBefore = before[0].points[0];
  const rightBefore = before[1].points[0];

  // Lasso a loop around the LEFT stroke only.
  await page.keyboard.press('s');
  const cx = box.x + box.width * 0.2;
  const r = box.width * 0.1;
  await page.mouse.move(cx - r, y - r);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    await page.mouse.move(cx - r * Math.cos(a), y - r * Math.sin(a));
  }
  await page.mouse.up();

  expect(
    await page.evaluate(() => (window as any).__scratchy.engine.getSelection().length),
  ).toBe(1);

  // Drag the selection to the lower-left.
  const dx = -box.width * 0.05;
  const dy = box.height * 0.2;
  await drag(page, cx, y, cx + dx, y + dy);

  const after = (await elements(page)) as any[];
  const left = after.find((el) => el.id === before[0].id);
  const right = after.find((el) => el.id === before[1].id);
  // Screen drag maps 1:1 to world at zoom 1, but the stage is CSS-scaled.
  const scale = 1280 / box.width;
  expect(left.points[0].x - leftBefore.x).toBeCloseTo(dx * scale, 0);
  expect(left.points[0].y - leftBefore.y).toBeCloseTo(dy * scale, 0);
  expect(right.points[0].x).toBeCloseTo(rightBefore.x, 1);
  expect(right.points[0].y).toBeCloseTo(rightBefore.y, 1);

  // Undo restores the moved stroke.
  await page.keyboard.press('z');
  const restored = (await elements(page)) as any[];
  const leftRestored = restored.find((el) => el.id === before[0].id);
  expect(leftRestored.points[0].x).toBeCloseTo(leftBefore.x, 1);
  expect(leftRestored.points[0].y).toBeCloseTo(leftBefore.y, 1);
});

test('selection deletes with Backspace and elements survive a reload', async ({ page }) => {
  const box = await stageBox(page);
  // One rect + one text.
  await page.keyboard.press('r');
  await drag(
    page,
    box.x + box.width * 0.3,
    box.y + box.height * 0.3,
    box.x + box.width * 0.45,
    box.y + box.height * 0.45,
  );
  await page.keyboard.press('t');
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.locator('.text-editor').fill('persists');
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.15);
  expect(await elements(page)).toHaveLength(2);

  // Reload: the v4 board round-trips both element kinds.
  await page.waitForTimeout(900); // let the debounced autosave flush
  await page.reload();
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');
  const els = (await elements(page)) as any[];
  expect(els).toHaveLength(2);
  expect(els.map((el) => el.kind).sort()).toEqual(['shape', 'text']);
  expect(els.find((el) => el.kind === 'text').text).toBe('persists');

  // Select the shape by tapping its edge, then delete it.
  await page.keyboard.press('s');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.375);
  expect(
    await page.evaluate(() => (window as any).__scratchy.engine.getSelection().length),
  ).toBe(1);
  await page.keyboard.press('Backspace');
  expect(await elements(page)).toHaveLength(1);
});

test('eraser removes shapes and text like strokes', async ({ page }) => {
  const box = await stageBox(page);
  await page.keyboard.press('r');
  await drag(
    page,
    box.x + box.width * 0.3,
    box.y + box.height * 0.3,
    box.x + box.width * 0.5,
    box.y + box.height * 0.5,
  );
  expect(await elements(page)).toHaveLength(1);

  await page.keyboard.press('e');
  // Swipe across the rectangle's top edge.
  await drag(
    page,
    box.x + box.width * 0.28,
    box.y + box.height * 0.3,
    box.x + box.width * 0.52,
    box.y + box.height * 0.3,
  );
  expect(await elements(page)).toHaveLength(0);
});
