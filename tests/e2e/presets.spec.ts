import { test, expect } from '@playwright/test';

/** Seed a preset choice plus a passing device profile so the probe is skipped
 *  and gated presets are allowed — each case tests the compositor pipeline. */
function seed(page: import('@playwright/test').Page, presetId: string) {
  return page.addInitScript((id) => {
    localStorage.setItem(
      'scratchy.settings.v1',
      JSON.stringify({ handedness: 'right', presetId: id }),
    );
    localStorage.setItem(
      'scratchy.deviceProfile.v1',
      JSON.stringify({
        version: 1,
        userAgent: navigator.userAgent,
        mimeType: 'video/webm',
        extension: '.webm',
        supports1080p: true,
        supportsVertical: true,
        storageAdapter: 'idb',
        pauseReliable: true,
        storageEstimate: null,
        lastProbeAt: Date.now(),
        warnings: [],
      }),
    );
  }, presetId);
}

async function recordShortTake(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'recording',
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
  return page.evaluate(async () => {
    const v = document.querySelector('.modal-video') as HTMLVideoElement;
    if (v.readyState < 1) {
      await new Promise((resolve) => v.addEventListener('loadedmetadata', resolve, { once: true }));
    }
    return { w: v.videoWidth, h: v.videoHeight };
  });
}

for (const [presetId, expected] of [
  ['compat', { w: 1280, h: 720 }],
  ['quality', { w: 1920, h: 1080 }],
  ['vertical', { w: 1080, h: 1920 }],
] as const) {
  test(`the ${presetId} preset records at ${expected.w}×${expected.h}`, async ({ page }) => {
    test.setTimeout(60_000);
    await seed(page, presetId);
    const dims = await recordShortTake(page);
    expect(dims).toEqual(expected);
  });
}

test('the vertical preset shows a 9:16 frame guide on the stage', async ({ page }) => {
  await seed(page, 'vertical');
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  const guide = page.locator('.frame-guide-window');
  await expect(guide).toBeVisible();
  // 720 * (1080/1920) = 405 stage px, set as an inline width.
  const width = await guide.evaluate((el) => (el as HTMLElement).style.width);
  expect(width).toBe('405px');
});

test('1080p-class presets are disabled when the profile failed the perf probe', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'scratchy.deviceProfile.v1',
      JSON.stringify({
        version: 1,
        userAgent: navigator.userAgent,
        mimeType: 'video/webm',
        extension: '.webm',
        supports1080p: false,
        supportsVertical: false,
        storageAdapter: 'idb',
        pauseReliable: true,
        storageEstimate: null,
        lastProbeAt: Date.now(),
        warnings: [],
      }),
    );
  });
  await page.goto('/');
  await page.waitForSelector('.boards-menu');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: '1080p preset' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Vertical preset' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '720p preset' })).toBeEnabled();
});
