import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

if (existsSync('.local/test.env')) process.loadEnvFile('.local/test.env');
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3182',
    channel: process.env.XC_BROWSER_CHANNEL || undefined,
    viewport: { width: 1440, height: 940 },
    screenshot: 'only-on-failure',
  },
});
