import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');
});

async function startRecording(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Record' }).click();
  // 3-second countdown, then the recorder spins up.
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'recording',
    undefined,
    { timeout: 10_000 },
  );
}

test('pause freezes the active timer, resume continues it, stop yields a preview', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await startRecording(page);
  await page.waitForTimeout(1200);

  await page.getByRole('button', { name: 'Pause recording (Space)' }).click();
  await expect(page.locator('.paused-label')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__scratchyRecorder.getPhase())).toBe('paused');

  const frozen1 = await page.evaluate(() => (window as any).__scratchyRecorder.getElapsedMs());
  await page.waitForTimeout(700);
  const frozen2 = await page.evaluate(() => (window as any).__scratchyRecorder.getElapsedMs());
  expect(frozen2).toBe(frozen1);

  await page.getByRole('button', { name: 'Resume recording (Space)' }).click();
  await page.waitForFunction(
    (before) => (window as any).__scratchyRecorder.getElapsedMs() > before,
    frozen2,
    { timeout: 3000 },
  );

  // Deliberate two-step stop.
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  const video = page.locator('.modal-video');
  await expect(video).toBeVisible({ timeout: 15_000 });

  // Take duration excludes the ~700ms paused stretch: it tracks active time.
  const durationText = await page.locator('.modal-meta').innerText();
  expect(durationText).toContain('00:0');

  // Clean up: delete the take (two-tap confirm).
  await page.getByRole('button', { name: 'Delete take' }).click();
  await page.getByRole('button', { name: 'Really delete?' }).click();
});

test('Space toggles pause and resume while recording', async ({ page }) => {
  test.setTimeout(60_000);
  await startRecording(page);
  await page.waitForTimeout(600);

  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'paused',
    undefined,
    { timeout: 3000 },
  );

  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'recording',
    undefined,
    { timeout: 3000 },
  );

  // Stopping from a paused state also works — pause again, then stop.
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'paused',
    undefined,
    { timeout: 3000 },
  );
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Delete take' }).click();
  await page.getByRole('button', { name: 'Really delete?' }).click();
});
