import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

/**
 * PWA suite (npm run test:pwa) — runs against a production build served by
 * `vite preview`, because the service worker only registers in PROD. Kept
 * out of the default config so `npm run test:e2e` doesn't rebuild the app.
 */
export default defineConfig({
  testDir: './tests/pwa',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1500, height: 900 },
    // Same first-launch seeding as the default config (see playwright.config.ts).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [{ name: 'scratchy.onboarding.v1', value: '1' }],
        },
      ],
    },
    launchOptions: existsSync(PREINSTALLED_CHROMIUM)
      ? { executablePath: PREINSTALLED_CHROMIUM }
      : {},
  },
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
