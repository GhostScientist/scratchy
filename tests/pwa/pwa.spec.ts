import { test, expect } from '@playwright/test';

test('the app installs a service worker and serves its shell offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest/);

  // Wait for the SW to activate — precaching completes during install.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  // The precached shell renders fully offline.
  await expect(page.locator('.rail')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.topbar')).toBeVisible();
  await context.setOffline(false);
});

test('the web app manifest is complete and installable', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(new URL(href!, 'http://localhost:4173').href)).json();
  expect(manifest.name).toBe('Scratchy Studio');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, 'http://localhost:4173').href);
    expect(res.ok()).toBe(true);
  }
});
