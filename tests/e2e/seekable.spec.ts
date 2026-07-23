import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Recorded files must be real, seekable videos — not the raw MediaRecorder
 * stream, which has no container duration (Apple players show it as an
 * endless "Live Broadcast" and some players refuse it entirely). The
 * post-stop remux (src/recording/remux.ts) rewrites every take into a
 * progressive MP4 or seekable WebM with a correct duration.
 */

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

async function recordTake(page: Page, seconds: number) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'recording',
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
}

/** Duration/seekability/container facts of a media element's blob URL. */
function inspectVideo(page: Page, selector: string) {
  return page.evaluate(async (sel) => {
    const v = document.querySelector(sel) as HTMLVideoElement;
    if (v.readyState < 1) {
      await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    }
    const bytes = new Uint8Array(await (await fetch(v.src)).arrayBuffer());
    const isEbml =
      bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    const isMp4 =
      String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp';
    return {
      duration: v.duration,
      finite: Number.isFinite(v.duration),
      seekableEnd: v.seekable.length > 0 ? v.seekable.end(v.seekable.length - 1) : 0,
      isEbml,
      isMp4,
      size: bytes.length,
    };
  }, selector);
}

test('a finished take is a seekable file with a real duration', async ({ page }) => {
  test.setTimeout(60_000);
  await seed(page);
  await recordTake(page, 3);

  const info = await inspectVideo(page, '.modal-video');
  // The raw MediaRecorder stream reports Infinity here — the remux must
  // produce a finite duration close to the recorded time, and a container
  // that is exactly what its extension claims.
  expect(info.finite).toBe(true);
  expect(info.duration).toBeGreaterThan(1.5);
  expect(info.duration).toBeLessThan(8);
  expect(info.seekableEnd).toBeGreaterThan(1.5);
  expect(info.isEbml || info.isMp4).toBe(true);
});

test('library takes play seekable, and legacy raw takes are healed on open', async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page);
  await recordTake(page, 2);

  // Save to library, then close the preview.
  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByRole('button', { name: 'Saved to library ✓' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Back to board' }).click();
  await expect(page.locator('.modal-scrim')).toBeHidden({ timeout: 10_000 });

  // Simulate a take stored before the remux fix: strip the seekable flag so
  // the drawer's heal-on-open path runs (remux is idempotent, so re-running
  // it on this blob still yields a valid seekable file).
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('scratchy');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const takes = await new Promise<any[]>((resolve, reject) => {
      const req = db.transaction('takes', 'readonly').objectStore('takes').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const take of takes) {
      delete take.seekable;
      await new Promise((resolve, reject) => {
        const req = db.transaction('takes', 'readwrite').objectStore('takes').put(take);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
      });
    }
    db.close();
  });

  await page.getByRole('button', { name: 'Saved takes' }).click();
  await page.locator('.take-open').first().click();
  await expect(page.locator('.take-video')).toBeVisible({ timeout: 15_000 });

  const info = await inspectVideo(page, '.take-video');
  expect(info.finite).toBe(true);
  expect(info.duration).toBeGreaterThan(1);
  expect(info.seekableEnd).toBeGreaterThan(1);

  // The heal persisted back: the stored take is now flagged seekable.
  const healed = await page.waitForFunction(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('scratchy');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const takes = await new Promise<any[]>((resolve, reject) => {
      const req = db.transaction('takes', 'readonly').objectStore('takes').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return takes.length > 0 && takes.every((t) => t.seekable === true);
  });
  expect(await healed.jsonValue()).toBe(true);
});

test('saving falls back to raw bytes when IndexedDB rejects Blob values', async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page);
  // Simulate the iOS Safari failure: IndexedDB refuses to store objects
  // holding a Blob (take rows only — chunk/board writes must keep working).
  await page.addInitScript(() => {
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      if (value && typeof value === 'object' && 'boardId' in value && value.blob instanceof Blob) {
        throw new DOMException('simulated Safari Blob clone failure', 'DataCloneError');
      }
      return key === undefined ? origPut.call(this, value) : origPut.call(this, value, key);
    };
  });
  await recordTake(page, 2);

  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByRole('button', { name: 'Saved to library ✓' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Back to board' }).click();
  await expect(page.locator('.modal-scrim')).toBeHidden({ timeout: 10_000 });

  // The bytes-stored take reads back as a playable, seekable video.
  await page.getByRole('button', { name: 'Saved takes' }).click();
  await page.locator('.take-open').first().click();
  await expect(page.locator('.take-video')).toBeVisible({ timeout: 15_000 });
  const info = await inspectVideo(page, '.take-video');
  expect(info.finite).toBe(true);
  expect(info.duration).toBeGreaterThan(1);
  // A static canvas compresses to almost nothing — just prove real bytes
  // round-tripped through the bytes-fallback storage.
  expect(info.size).toBeGreaterThan(1000);
});
