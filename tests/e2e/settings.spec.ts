import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');
});

test('left-handed mode moves the toolbar rail to the right and persists', async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');

  const before = await page.locator('.rail').boundingBox();
  if (!before) throw new Error('rail not found');
  expect(before.x + before.width / 2).toBeLessThan(viewport.width / 2);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Left-handed' }).click();

  const after = await page.locator('.rail').boundingBox();
  if (!after) throw new Error('rail not found');
  expect(after.x + after.width / 2).toBeGreaterThan(viewport.width / 2);

  // The reserved gutter flips with the rail, so the stage shifts leftward.
  await expect(page.getByRole('button', { name: 'Left-handed' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Device-global preference survives a reload.
  await page.reload();
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  const reloaded = await page.locator('.rail').boundingBox();
  if (!reloaded) throw new Error('rail not found');
  expect(reloaded.x + reloaded.width / 2).toBeGreaterThan(viewport.width / 2);

  // Back to right-handed for a clean slate.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Right-handed' }).click();
  const restored = await page.locator('.rail').boundingBox();
  if (!restored) throw new Error('rail not found');
  expect(restored.x + restored.width / 2).toBeLessThan(viewport.width / 2);
});

test('toolbar flyouts open toward the stage in left-handed mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Left-handed' }).click();

  // Opening a rail flyout also closes the settings menu (outside pointerdown).
  await page.getByRole('button', { name: 'Ink color' }).click();
  const rail = await page.locator('.rail').boundingBox();
  const flyout = await page.locator('.flyout').boundingBox();
  if (!rail || !flyout) throw new Error('rail or flyout not found');
  // Flyout sits to the LEFT of the rail (toward the stage).
  expect(flyout.x + flyout.width).toBeLessThanOrEqual(rail.x + 1);

  // Reset for other tests.
  await page.evaluate(() => localStorage.removeItem('scratchy.settings.v1'));
});
