// Browser end-to-end tests for the LifeOS interface. Run them with
// `npm run test:e2e` (scripts/e2e.mjs), which installs the pinned Chromium on
// first use; every test starts its own server on a throwaway demo store.
import { defineConfig, devices } from '@playwright/test';
import { BROWSERS_PATH, RESULTS_DIR } from './environment.mjs';

// Workers inherit this, so a direct `playwright test` finds the same browser.
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  // AppleDouble sidecars that external (exFAT) volumes create beside each file.
  testIgnore: '**/._*',
  outputDir: RESULTS_DIR,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    // The demo store's own time zone, so the browser and the server agree on "today".
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium' }],
});
