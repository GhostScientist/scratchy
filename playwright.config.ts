import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Remote sandboxes pre-install a Chromium (possibly from a different
// Playwright revision) at this path; local runs use the default download.
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1500, height: 900 },
    // The display backing scale is DPR-aware; pin the historical 2× so canvas
    // dimension assertions are deterministic across environments.
    deviceScaleFactor: 2,
    // Specs start from a fresh origin; mark the first-launch welcome tour as
    // seen so it doesn't cover the app. onboarding.spec.ts opts back out.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [{ name: 'scratchy.onboarding.v1', value: '1' }],
        },
      ],
    },
    launchOptions: {
      // Fake camera/mic so recording tests never hit a permission prompt.
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
      ...(existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : {}),
    },
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
  },
});
