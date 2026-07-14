import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function strokeCount(page: Page) {
  return page.evaluate(() => (window as any).__scratchy.engine.getStrokes().length);
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

test('boards keep separate content and survive reload', async ({ page }) => {
  await page.locator('.title-input').fill('Algebra');
  await drawLine(page, 0.3, 0.3, 0.5, 0.5);
  await drawLine(page, 0.5, 0.5, 0.7, 0.3);
  expect(await strokeCount(page)).toBe(2);

  // Create a second, blank board.
  await page.getByRole('button', { name: 'Boards' }).click();
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.locator('.title-input')).toHaveValue('Untitled lesson');
  expect(await strokeCount(page)).toBe(0);

  await page.locator('.title-input').fill('Geometry');
  await drawLine(page, 0.4, 0.6, 0.6, 0.6);
  expect(await strokeCount(page)).toBe(1);

  // Switch back to the first board via the menu.
  await page.getByRole('button', { name: 'Boards' }).click();
  await page.locator('.board-open', { hasText: 'Algebra' }).click();
  await expect(page.locator('.title-input')).toHaveValue('Algebra');
  expect(await strokeCount(page)).toBe(2);

  // Reload: the active board and both boards persist.
  await page.waitForTimeout(900); // debounced autosave
  await page.reload();
  await page.waitForSelector('.boards-menu');
  await expect(page.locator('.title-input')).toHaveValue('Algebra');
  expect(await strokeCount(page)).toBe(2);

  await page.getByRole('button', { name: 'Boards' }).click();
  await expect(page.locator('.board-row')).toHaveCount(2);
});

test('deleting the active board falls back to another board', async ({ page }) => {
  await page.locator('.title-input').fill('First');
  await drawLine(page, 0.3, 0.3, 0.5, 0.5);

  await page.getByRole('button', { name: 'Boards' }).click();
  await page.getByRole('button', { name: 'New board' }).click();
  await page.locator('.title-input').fill('Second');
  await page.waitForTimeout(900);

  // Delete the active board ("Second") — two taps to confirm.
  await page.getByRole('button', { name: 'Boards' }).click();
  const activeRow = page.locator('.board-row.active');
  await activeRow.getByRole('button', { name: /Delete/ }).click();
  await activeRow.getByRole('button', { name: /Really delete/ }).click();

  await expect(page.locator('.title-input')).toHaveValue('First');
  expect(await strokeCount(page)).toBe(1);

  const boards = await page.evaluate(() => (window as any).__scratchyBoards.listBoards());
  expect(boards).toHaveLength(1);
  expect(boards[0].title).toBe('First');
});

test('takes library stores, plays, and deletes a take', async ({ page }) => {
  // Seed a fake take for the active board (avoids MediaRecorder in headless).
  await page.evaluate(async () => {
    const api = (window as any).__scratchyBoards;
    const { board } = await api.initBoards();
    await api.saveTake({
      id: 't-test-1',
      boardId: board.id,
      title: 'My take',
      blob: new Blob(['fake-video-bytes'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      extension: '.webm',
      durationMs: 65_000,
      createdAt: Date.now(),
    });
  });

  await page.getByRole('button', { name: 'Saved takes' }).click();
  const row = page.locator('.take-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.take-title')).toHaveText('My take');
  await expect(row.locator('.take-meta')).toContainText('01:05');

  // Expanding creates the object URL: video + download appear.
  await row.locator('.take-open').click();
  await expect(row.locator('video')).toBeVisible();
  const href = await row.locator('a[download]').getAttribute('href');
  expect(href).toMatch(/^blob:/);

  await row.getByRole('button', { name: 'Delete' }).click();
  await row.getByRole('button', { name: /Really delete/ }).click();
  await expect(page.locator('.takes-empty')).toBeVisible();

  const takes = await page.evaluate(async () => {
    const api = (window as any).__scratchyBoards;
    const { board } = await api.initBoards();
    return api.listTakes(board.id);
  });
  expect(takes).toHaveLength(0);
});
