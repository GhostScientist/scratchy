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
