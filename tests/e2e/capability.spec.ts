import { test, expect } from '@playwright/test';

const PROFILE_KEY = 'scratchy.deviceProfile.v1';

test('first record runs the capability probe and caches a device profile', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');
  expect(await page.evaluate((k) => localStorage.getItem(k), PROFILE_KEY)).toBeNull();

  await page.getByRole('button', { name: 'Record' }).click();
  // Probe (~1.5s) + countdown (3s) → recording.
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'recording',
    undefined,
    { timeout: 20_000 },
  );

  const profile = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k) ?? 'null'),
    PROFILE_KEY,
  );
  expect(profile).not.toBeNull();
  expect(profile.mimeType).toContain('video/');
  expect(typeof profile.supports1080p).toBe('boolean');
  expect(typeof profile.pauseReliable).toBe('boolean');
  expect(profile.storageAdapter).toBe('idb');
  const firstProbeAt = profile.lastProbeAt;

  // Stop, then record again: the cached profile is reused, not re-probed.
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Delete take' }).click();
  await page.getByRole('button', { name: 'Really delete?' }).click();

  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'recording',
    undefined,
    { timeout: 15_000 },
  );
  const again = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k) ?? 'null'),
    PROFILE_KEY,
  );
  expect(again.lastProbeAt).toBe(firstProbeAt);

  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
});

test('a browser without MediaRecorder gets a specific error and no countdown', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Simulate an unsupported browser.
    delete (window as any).MediaRecorder;
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');

  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.locator('.toast')).toContainText("can't record video", { timeout: 10_000 });
  expect(await page.evaluate(() => (window as any).__scratchyRecorder.getPhase())).toBe('idle');
  // No profile is cached for a failed probe.
  expect(
    await page.evaluate(() => localStorage.getItem('scratchy.deviceProfile.v1')),
  ).toBeNull();
});

test('a failing smoke test warns but never blocks recording', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    // A recorder that exists and negotiates formats but never records:
    // start() is swallowed, so the probe's smoke runs produce zero data.
    const Real = window.MediaRecorder;
    class SilentRecorder extends Real {
      start() {
        // Never actually starts.
      }
    }
    (SilentRecorder as any).isTypeSupported = Real.isTypeSupported.bind(Real);
    (window as any).MediaRecorder = SilentRecorder;
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');

  await page.getByRole('button', { name: 'Record' }).click();
  // The probe fails its smoke test, warns, and still starts the countdown.
  await expect(
    page.locator('.toast', { hasText: 'could not produce a test recording' }),
  ).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const phase = (window as any).__scratchyRecorder.getPhase();
      return phase === 'countdown' || phase === 'recording';
    },
    undefined,
    { timeout: 15_000 },
  );
  // A failed smoke test is never cached.
  expect(
    await page.evaluate(() => localStorage.getItem('scratchy.deviceProfile.v1')),
  ).toBeNull();
});

test('the settings menu shows the negotiated format after a device check', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.settings-device').last()).toContainText('Not checked yet');
  await page.getByRole('button', { name: 'Run device check' }).click();
  await expect(page.locator('.settings-device').last()).toContainText('Records', {
    timeout: 20_000,
  });
});
