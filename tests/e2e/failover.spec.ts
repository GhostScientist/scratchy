import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A format can pass MediaRecorder.isTypeSupported and still record nothing —
 * some Safari builds do exactly that for webm on canvas streams, which once
 * surfaced as "The recording produced no data" and a dead take. The recorder
 * must notice the silence and restart with the next negotiable format, losing
 * nothing (no bytes existed yet).
 *
 * Simulated here by patching MediaRecorder before the app loads: mp4 support
 * is denied (so negotiation starts at webm/vp9) and vp9 recorders swallow
 * their data events; the vp8 fallback works normally.
 */

function patchBrokenVp9(page: Page) {
  return page.addInitScript(() => {
    const Real = window.MediaRecorder;
    const broken = (m: string) => m.includes('vp9');
    class PatchedRecorder extends Real {
      private __broken: boolean;
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        this.__broken = broken(options?.mimeType ?? '');
      }
      set ondataavailable(fn: ((e: BlobEvent) => void) | null) {
        // A broken format stays silent: the handler is never attached.
        super.ondataavailable = this.__broken ? null : fn;
      }
      get ondataavailable() {
        return super.ondataavailable;
      }
    }
    PatchedRecorder.isTypeSupported = (m: string) =>
      !m.includes('mp4') && Real.isTypeSupported(m);
    (window as any).MediaRecorder = PatchedRecorder;
  });
}

function seed(page: Page) {
  return page.addInitScript(() => {
    localStorage.setItem(
      'scratchy.settings.v1',
      JSON.stringify({ handedness: 'right', presetId: 'compat' }),
    );
    localStorage.setItem(
      'scratchy.deviceProfile.v1',
      JSON.stringify({
        version: 1,
        userAgent: navigator.userAgent,
        mimeType: 'video/webm',
        extension: '.webm',
        smokeOk: true,
        supports1080p: true,
        supportsVertical: true,
        storageAdapter: 'idb',
        pauseReliable: true,
        storageEstimate: null,
        lastProbeAt: Date.now(),
        warnings: [],
      }),
    );
  });
}

test('a format that records no bytes fails over to the next one mid-take', async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page);
  await patchBrokenVp9(page);

  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'recording',
    undefined,
    { timeout: 15_000 },
  );

  // The silent vp9 recorder trips the first-bytes watchdog and the app
  // restarts on vp8 without erroring or leaving the recording phase.
  await expect(page.locator('.toast', { hasText: 'compatible format' })).toBeVisible({
    timeout: 15_000,
  });
  expect(
    await page.evaluate(() => (window as any).__scratchyRecorder.getPhase()),
  ).toBe('recording');

  // Capture a couple of real seconds on the fallback format, then stop.
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });

  const info = await page.evaluate(async () => {
    const v = document.querySelector('.modal-video') as HTMLVideoElement;
    if (v.readyState < 1) {
      await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    }
    return { duration: v.duration, finite: Number.isFinite(v.duration) };
  });
  expect(info.finite).toBe(true);
  expect(info.duration).toBeGreaterThan(1);
});
