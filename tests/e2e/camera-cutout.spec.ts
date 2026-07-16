import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Camera background removal ("cutout" shape). Runs real MediaPipe inference
// on the wasm CPU/GPU delegate — verified to work under headless Chromium's
// software GL, but generously timed for slow CI runners.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyCutout !== undefined);
});

async function enableCamera(page: Page) {
  await page.getByRole('button', { name: 'Enable camera (C)' }).click();
  await page.waitForSelector('.camera-overlay video');
}

test('selecting cutout segments the feed and swaps the preview to a canvas', async ({ page }) => {
  test.setTimeout(120_000);
  // The perf watchdog is meant for real devices; software-rendered CI would
  // trip it and turn the test into the fallback path.
  await page.evaluate(() => (window as any).__scratchyCutout.setBudgetMs(1e9));
  await enableCamera(page);

  await page.getByRole('button', { name: 'Cutout camera (remove background)' }).click();
  await page.waitForFunction(() => (window as any).__scratchyCutout.getState() === 'ready', null, {
    timeout: 90_000,
  });

  // The engine canvas takes over the frame; the (still playing) video hides.
  await expect(page.locator('.cam-cutout-mount canvas')).toBeVisible();
  await expect(page.locator('.cam-frame')).toHaveClass(/is-cutout/);
  await expect(page.locator('.cam-frame video')).toBeHidden();
  await expect(page.locator('.toast')).toHaveCount(0);

  // First composited frame lands at video size shortly after ready.
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.cam-cutout-mount canvas');
    return !!canvas && canvas.width > 0;
  });

  // The fake camera's test pattern has no person in it, so a correct mask
  // leaves the canvas essentially transparent — background removed.
  const opaqueShare = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.cam-cutout-mount canvas')!;
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let opaque = 0;
    let sampled = 0;
    for (let i = 3; i < data.length; i += 40) {
      sampled += 1;
      if (data[i] > 200) opaque += 1;
    }
    return opaque / sampled;
  });
  expect(opaqueShare).toBeLessThan(0.2);

  // Switching back to a framed shape disposes the engine and restores video.
  await page.getByRole('button', { name: 'Rounded camera' }).click();
  await page.waitForFunction(() => (window as any).__scratchyCutout.getState() === 'idle');
  await expect(page.locator('.cam-frame video')).toBeVisible();
  await expect(page.locator('.cam-cutout-mount')).toHaveCount(0);
});

test('a segmentation failure reverts to the rounded shape with a notice', async ({ page }) => {
  await page.evaluate(() => (window as any).__scratchyCutout.forceFailure());
  await enableCamera(page);

  await page.getByRole('button', { name: 'Cutout camera (remove background)' }).click();

  await expect(page.locator('.toast')).toContainText('Background removal is unavailable');
  await expect(
    page.getByRole('button', { name: 'Rounded camera' }),
  ).toHaveClass(/active/);
  // The failure is sticky for the session: the button stays disabled.
  await expect(
    page.getByRole('button', { name: 'Background removal is unavailable on this device' }),
  ).toBeDisabled();
  // The camera itself keeps working, framed.
  await expect(page.locator('.cam-frame video')).toBeVisible();
});
