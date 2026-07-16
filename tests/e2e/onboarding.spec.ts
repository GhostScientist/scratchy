import { test, expect } from '@playwright/test';

// The suite-wide storageState marks the tour as seen; these tests exercise
// the true first-launch experience, so start from a genuinely empty origin.
test.use({ storageState: { cookies: [], origins: [] } });

test('welcome tour shows once on first launch and can be completed', async ({ page }) => {
  await page.goto('/');
  const dialog = page.locator('.modal-scrim[aria-label="Welcome tour"]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.onboard-dot')).toHaveCount(5);
  await expect(page.locator('.onboard-body h2')).toHaveText('Welcome to Scribble Party');

  // No demo clips ship in the repo — the animated fallback art is the
  // default experience and must be visible.
  await expect(page.locator('.onboard-fallback .party-dot').first()).toBeVisible();

  // Walk every slide to the end.
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await expect(page.locator('.onboard-body h2')).toHaveText('Made for teaching anywhere');
  await page.getByRole('button', { name: 'Start scribbling' }).click();
  await expect(dialog).toBeHidden();

  // Completion persists: a reload goes straight to the board.
  expect(await page.evaluate(() => localStorage.getItem('scratchy.onboarding.v1'))).toBe('1');
  await page.reload();
  await page.waitForSelector('.rail');
  await expect(dialog).toBeHidden();
});

test('skip closes the tour and marks it seen', async ({ page }) => {
  await page.goto('/');
  const dialog = page.locator('.modal-scrim[aria-label="Welcome tour"]');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('scratchy.onboarding.v1'))).toBe('1');
});

test('tour can be replayed from settings and closed with Escape', async ({ page }) => {
  await page.goto('/');
  const dialog = page.locator('.modal-scrim[aria-label="Welcome tour"]');
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Replay welcome tour' }).click();
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('arrow keys and dots navigate between slides', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.onboard-body h2')).toHaveText('Welcome to Scribble Party');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.onboard-body h2')).toHaveText('An endless canvas');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.onboard-body h2')).toHaveText('Welcome to Scribble Party');

  await page.locator('.onboard-dot').nth(3).click();
  await expect(page.locator('.onboard-body h2')).toHaveText('Record and keep every take');
});
