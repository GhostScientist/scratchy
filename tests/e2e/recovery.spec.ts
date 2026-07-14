import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');
});

async function startRecording(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForFunction(
    () => (window as any).__scratchyRecorder.getPhase() === 'recording',
    undefined,
    { timeout: 20_000 },
  );
}

/** Persisted chunk count of the live session (page.evaluate awaits promises,
 *  unlike waitForFunction — hence expect.poll around it). */
function chunkCount(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const store = (window as any).__scratchyRecStore;
    const sessions = await store.listSessions();
    if (sessions.length === 0) return 0;
    return store.countChunks(sessions[0].sessionId);
  });
}

function sessionCount(page: import('@playwright/test').Page) {
  return page.evaluate(
    async () => (await (window as any).__scratchyRecStore.listSessions()).length,
  );
}

test('chunks persist incrementally and a clean stop removes the session', async ({ page }) => {
  test.setTimeout(90_000);
  await startRecording(page);
  await expect.poll(() => chunkCount(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

  const manifest = await page.evaluate(
    async () => (await (window as any).__scratchyRecStore.listSessions())[0],
  );
  expect(manifest.state).toBe('recording');
  expect(manifest.chunkCount).toBeGreaterThanOrEqual(1);
  expect(manifest.updatedAt).toBeGreaterThanOrEqual(manifest.startedAt);
  expect(manifest.mimeType).toContain('video/');

  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Back to board' }).click();

  await expect.poll(() => sessionCount(page), { timeout: 10_000 }).toBe(0);
});

test('a reload mid-recording offers recovery and the recovered take plays', async ({ page }) => {
  test.setTimeout(90_000);
  await startRecording(page);
  await expect.poll(() => chunkCount(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

  await page.reload();
  await page.waitForSelector('.recovery-card', { timeout: 15_000 });
  await expect(page.locator('.recovery-info span')).toContainText('MB');

  await page.getByRole('button', { name: 'Recover' }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
  const playable = await page.evaluate(async () => {
    const v = document.querySelector('.modal-video') as HTMLVideoElement;
    if (v.readyState < 1) {
      await new Promise((resolve) => v.addEventListener('loadedmetadata', resolve, { once: true }));
    }
    // Streamed recordings can report Infinity — either way it parsed as media.
    return v.duration > 0;
  });
  expect(playable).toBe(true);

  // Closing the recovered preview retires the session.
  await page.getByRole('button', { name: 'Back to board' }).click();
  await expect.poll(() => sessionCount(page), { timeout: 10_000 }).toBe(0);
});

test('discarding an interrupted recording cleans both stores', async ({ page }) => {
  test.setTimeout(90_000);
  await startRecording(page);
  await expect.poll(() => chunkCount(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  const sessionId = await page.evaluate(
    async () => (await (window as any).__scratchyRecStore.listSessions())[0].sessionId,
  );

  await page.reload();
  await page.waitForSelector('.recovery-card', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.recovery-card')).toBeHidden();

  await expect.poll(() => sessionCount(page), { timeout: 10_000 }).toBe(0);
  expect(
    await page.evaluate(
      async (id) => (window as any).__scratchyRecStore.countChunks(id),
      sessionId,
    ),
  ).toBe(0);
});
