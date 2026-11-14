import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}/beatboy/`;

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: BASE_URL,
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-subpath.mjs',
    url: BASE_URL,
    reuseExistingServer: true,
  },
});
