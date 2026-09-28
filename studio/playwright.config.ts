import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// =============================================================================
// End-to-end tests against `next start` (mock AI providers + staging WooCommerce)
// =============================================================================
// Prerequisites: `npm run build`, a running staging store (../staging) and a
// .env.local with STUDIO_PROVIDERS=mock and the staging credentials.
// PW_CHROMIUM_PATH lets you reuse a preinstalled Chromium when the browser
// revision bundled with this Playwright version cannot be downloaded.

const chromium = process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: existsSync(chromium) ? { executablePath: chromium } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
