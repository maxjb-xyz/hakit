/**
 * T-701 E2E. Default: starts `vite dev` in mock mode on :5174 and runs against it.
 * Real mode: E2E_BASE_URL=<preview url> E2E_LOGIN_SECRET=… [E2E_WEBHOOK_SECRET=…] [E2E_REPO_ID=…] (e2e/support.ts).
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: external
    ? undefined
    : {
        command: `vite dev --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/api/v1/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // Process env → worker vars, so the run doesn't depend on a local .dev.vars.
        env: {
          CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
          HAKIT_MOCKS: '1',
          APP_URL: `http://localhost:${PORT}`,
        },
      },
});
