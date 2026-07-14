import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
});

test('laser pointer leaves a fading trail and no ink', async ({ page }) => {
  await page.keyboard.press('l');

  const box = await page.locator('.stage-input').boundingBox();
  if (!box) throw new Error('stage not found');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();

  const trailLen = await page.evaluate(
    () => (window as any).__scratchy.engine.getLaserTrail().length,
  );
  expect(trailLen).toBeGreaterThan(2);

  // Fades out on its own and never becomes document ink.
  await page.waitForFunction(
    () => (window as any).__scratchy.engine.getLaserTrail().length === 0,
    undefined,
    { timeout: 3000 },
  );
  expect(
    await page.evaluate(() => (window as any).__scratchy.engine.getStrokes().length),
  ).toBe(0);

  // Undo has nothing to undo — the trail is not a command.
  expect(await page.locator('[aria-label^="Undo"]').isDisabled()).toBe(true);
});
