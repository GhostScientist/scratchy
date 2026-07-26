import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Portrait-phone support: the stage window flips to 9:16, the recording
 * preset auto-switches to Vertical (session override with Undo), layout is
 * frozen mid-take, and the tool rail becomes a bottom bar.
 */

const PHONE = { width: 390, height: 844 };
const LANDSCAPE = { width: 1000, height: 600 };

/** Seed settings + a passing device profile so the probe never runs. */
function seed(page: Page, presetId = 'compat', supports1080p = true) {
  return page.addInitScript(
    (arg: { presetId: string; supports1080p: boolean }) => {
      localStorage.setItem(
        'scratchy.settings.v1',
        JSON.stringify({ handedness: 'right', presetId: arg.presetId }),
      );
      localStorage.setItem(
        'scratchy.deviceProfile.v1',
        JSON.stringify({
          version: 1,
          userAgent: navigator.userAgent,
          mimeType: 'video/webm',
          extension: '.webm',
          smokeOk: true,
          supports1080p: arg.supports1080p,
          supportsVertical: arg.supports1080p,
          storageAdapter: 'idb',
          pauseReliable: true,
          storageEstimate: null,
          lastProbeAt: Date.now(),
          warnings: [],
        }),
      );
    },
    { presetId, supports1080p },
  );
}

async function openApp(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');
}

function stageSize(page: Page) {
  return page.evaluate(
    () => (window as any).__scratchy.viewport.getStageSize() as { w: number; h: number },
  );
}

/** Wait out the 150ms orientation debounce until the stage matches. */
function waitForStage(page: Page, w: number, h: number) {
  return page.waitForFunction(
    ([ew, eh]) => {
      const s = (window as any).__scratchy.viewport.getStageSize();
      return s.w === ew && s.h === eh;
    },
    [w, h] as const,
    { timeout: 5000 },
  );
}

test.describe('portrait phone', () => {
  test.use({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test('the stage renders as a 9:16 window with recording-safe backing', async ({ page }) => {
    await seed(page);
    await openApp(page);
    expect(await stageSize(page)).toEqual({ w: 720, h: 1280 });

    // The stage div carries the logical size inline; canvases carry backing.
    const stage = await page
      .locator('.stage')
      .evaluate((el) => ({ w: (el as HTMLElement).style.width, h: (el as HTMLElement).style.height }));
    expect(stage).toEqual({ w: '720px', h: '1280px' });

    const canvas = await page
      .locator('canvas.stage-input')
      .evaluate((el) => ({ w: (el as HTMLCanvasElement).width, h: (el as HTMLCanvasElement).height }));
    // dpr 2 within budget → 2× backing, and always ≥ the vertical preset's
    // 1080×1920 output for a clean downscale.
    expect(canvas).toEqual({ w: 1440, h: 2560 });
  });

  test('the stage is centered on-screen and its layout box matches its visual box', async ({
    page,
  }) => {
    await seed(page);
    await openApp(page);
    const box = await page.locator('.stage').boundingBox();
    if (!box) throw new Error('stage not found');
    // Fully on-screen and horizontally centered — regression guard for the
    // iOS Safari clipping bug (WebKit start-aligns overflowing centered flex
    // items, so the stage was pushed right and cut off).
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(Math.abs(box.x + box.width / 2 - PHONE.width / 2)).toBeLessThanOrEqual(12);
    // The engine-independent invariant behind the fix: the scale box's LAYOUT
    // size equals the stage's VISUAL (transformed) size, so flex centering
    // never sees an overflowing child on any engine.
    const layout = await page.locator('.stage-scale-box').evaluate((el) => ({
      w: (el as HTMLElement).offsetWidth,
      h: (el as HTMLElement).offsetHeight,
    }));
    expect(Math.abs(layout.w - box.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.h - box.height)).toBeLessThanOrEqual(1);

    // Nothing may widen the page (the topbar's min-content once inflated the
    // whole grid to ~740px), and the primary action stays reachable.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE.width);
    const record = await page.getByRole('button', { name: 'Record' }).boundingBox();
    if (!record) throw new Error('record button not found');
    expect(record.x + record.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('the tool rail becomes a bottom bar and the side gutter is reclaimed', async ({ page }) => {
    await seed(page);
    await openApp(page);
    const rail = await page.locator('.rail').boundingBox();
    if (!rail) throw new Error('rail not found');
    // Bottom bar: sits in the lower fifth of the screen, wider than tall,
    // and never wider than the screen.
    expect(rail.y).toBeGreaterThan(PHONE.height * 0.8);
    expect(rail.width).toBeGreaterThan(rail.height);
    expect(rail.x).toBeGreaterThanOrEqual(0);
    expect(rail.x + rail.width).toBeLessThanOrEqual(PHONE.width);

    // The collapse chevron is dropped from the bottom bar (it was the button
    // left half-clipped at the screen edge).
    await expect(page.locator('.rail-collapse')).toBeHidden();

    const fit = await page.locator('.stage-fit').boundingBox();
    if (!fit) throw new Error('stage-fit not found');
    // The 96px landscape rail gutter is gone.
    expect(fit.x).toBeLessThan(20);
  });

  test('portrait auto-selects the Vertical preset as an undoable session override', async ({
    page,
  }) => {
    await seed(page, 'compat');
    await openApp(page);

    const toast = page.locator('.toast', { hasText: 'switched to Vertical' });
    await expect(toast).toBeVisible();

    // Session override only — the saved preference is untouched.
    const savedPreset = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('scratchy.settings.v1')!).presetId);
    expect(await savedPreset()).toBe('compat');

    // Vertical matches the portrait stage, so nothing is cropped: no guide.
    await expect(page.locator('.frame-guide')).toHaveCount(0);

    // Undo reverts to the saved 720p preset; the stage stays portrait and the
    // frame guide marks the 16:9 band a 720p recording would capture.
    await toast.getByRole('button', { name: 'Undo' }).click();
    const guide = page.locator('.frame-guide-window');
    await expect(guide).toBeVisible();
    const inline = await guide.evaluate((el) => ({
      w: (el as HTMLElement).style.width,
      h: (el as HTMLElement).style.height,
    }));
    // 720 / (16/9) = 405 stage px tall, full stage width.
    expect(inline).toEqual({ w: '720px', h: '405px' });
    expect(await savedPreset()).toBe('compat');
    expect(await stageSize(page)).toEqual({ w: 720, h: 1280 });
  });

  test('perf-gated devices keep their preset and get a hint instead', async ({ page }) => {
    await seed(page, 'compat', false);
    await openApp(page);
    await expect(page.locator('.toast', { hasText: 'Vertical recording is unavailable' })).toBeVisible();
    // No override: the 720p crop guide shows what the video will capture.
    await expect(page.locator('.frame-guide-window')).toBeVisible();
  });

  test('rotation keeps the world center and preserves drawn ink', async ({ page }) => {
    await seed(page);
    await openApp(page);

    // Draw a stroke, then capture it and the visible world center.
    const box = await page.locator('.stage-input').boundingBox();
    if (!box) throw new Error('stage not found');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();

    const before = await page.evaluate(() => {
      const s = (window as any).__scratchy;
      const view = s.viewport.get();
      const stage = s.viewport.getStageSize();
      return {
        elements: s.engine.getElements().length,
        firstPoint: s.engine.getElements()[0].points[0],
        center: {
          x: view.x + stage.w / (2 * view.zoom),
          y: view.y + stage.h / (2 * view.zoom),
          zoom: view.zoom,
        },
      };
    });
    expect(before.elements).toBe(1);

    await page.setViewportSize(LANDSCAPE);
    await waitForStage(page, 1280, 720);

    const after = await page.evaluate(() => {
      const s = (window as any).__scratchy;
      const view = s.viewport.get();
      const stage = s.viewport.getStageSize();
      return {
        elements: s.engine.getElements().length,
        firstPoint: s.engine.getElements()[0].points[0],
        center: {
          x: view.x + stage.w / (2 * view.zoom),
          y: view.y + stage.h / (2 * view.zoom),
          zoom: view.zoom,
        },
      };
    });
    // World-space content is untouched and what you looked at stays centered
    // at the same zoom.
    expect(after.elements).toBe(1);
    expect(after.firstPoint).toEqual(before.firstPoint);
    expect(after.center.zoom).toBeCloseTo(before.center.zoom, 5);
    expect(after.center.x).toBeCloseTo(before.center.x, 3);
    expect(after.center.y).toBeCloseTo(before.center.y, 3);

    // Rotating back to landscape also clears the auto-switch override.
    await expect(page.locator('.toast', { hasText: 'back to 720p' })).toBeVisible();
  });

  test('rotation is frozen while recording and applies after the take ends', async ({ page }) => {
    test.setTimeout(60_000);
    await seed(page);
    await openApp(page);
    await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
    expect(await stageSize(page)).toEqual({ w: 720, h: 1280 });

    await page.getByRole('button', { name: 'Record' }).click();
    await page.waitForFunction(
      () => (window as any).__scratchyRecorder.getPhase() === 'recording',
      undefined,
      { timeout: 15_000 },
    );

    // Rotate mid-take: the stage must not move; the lock hint appears.
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator('.toast', { hasText: 'locked while recording' })).toBeVisible();
    await page.waitForTimeout(600); // debounce + a frame — still frozen?
    expect(await stageSize(page)).toEqual({ w: 720, h: 1280 });

    await page.getByRole('button', { name: 'Stop recording' }).click();
    await page.getByRole('button', { name: 'End' }).click();
    await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });

    // The recorded take used the frozen portrait setup: 1080×1920 output.
    const dims = await page.evaluate(async () => {
      const v = document.querySelector('.modal-video') as HTMLVideoElement;
      if (v.readyState < 1) {
        await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
      }
      return { w: v.videoWidth, h: v.videoHeight };
    });
    expect(dims).toEqual({ w: 1080, h: 1920 });

    // The pending rotation lands once the recorder is done.
    await waitForStage(page, 1280, 720);
  });

  test('the camera bubble is re-clamped into the stage after rotation', async ({ page }) => {
    await seed(page);
    await openApp(page);
    await page.getByRole('button', { name: 'Enable camera (C)' }).click();
    await expect(page.locator('.camera-overlay')).toBeVisible({ timeout: 10_000 });

    await page.setViewportSize(LANDSCAPE);
    await waitForStage(page, 1280, 720);

    const layout = await page.locator('.camera-overlay').evaluate((el) => {
      const s = (el as HTMLElement).style;
      return {
        x: parseFloat(s.left),
        y: parseFloat(s.top),
        w: parseFloat(s.width),
        h: parseFloat(s.height),
      };
    });
    expect(layout.x).toBeGreaterThanOrEqual(0);
    expect(layout.y).toBeGreaterThanOrEqual(0);
    expect(layout.x + layout.w).toBeLessThanOrEqual(1280);
    expect(layout.y + layout.h).toBeLessThanOrEqual(720);
  });
});

test.describe('portrait phone at dpr 3', () => {
  test.use({
    viewport: PHONE,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test('the backing scale is memory-capped but stays above the recording floor', async ({
    page,
  }) => {
    await seed(page);
    await openApp(page);
    const canvas = await page
      .locator('canvas.stage-input')
      .evaluate((el) => ({ w: (el as HTMLCanvasElement).width, h: (el as HTMLCanvasElement).height }));
    const backing = canvas.w / 720;
    // Below raw dpr (3) because of the area budget…
    expect(backing).toBeLessThan(3);
    expect(canvas.w * canvas.h).toBeLessThanOrEqual(5_050_000);
    // …but never below the vertical preset's clean-downscale floor (1.5).
    expect(backing).toBeGreaterThanOrEqual(1.5);
  });
});
