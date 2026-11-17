// Playwright runs the e2e specs against the browser preview (preview/), served by preview/serve.mjs with the plugin's
// real daemon half, on the deterministic fixture workspace from e2e/fixtures.mjs. Chromium only.
// Everything a run produces (HTML report, JSON results, traces, screenshots) goes to e2e/.artifacts/, which CI uploads.

import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { join } from "node:path";
import { ARTIFACTS, BASE_URL, FIXTURE_ROOT, PORT } from "./e2e/paths.ts";

const CI = Boolean(process.env.CI);

// Workers inherit this, so every spec sees the same fixture root.
process.env.E2E_FIXTURE_ROOT = FIXTURE_ROOT;

type Reporter = Extract<NonNullable<PlaywrightTestConfig["reporter"]>, readonly unknown[]>[number];
const reporter: Reporter[] = [
  ["list"],
  ["html", { outputFolder: join(ARTIFACTS, "report"), open: "never" }],
  ["json", { outputFile: join(ARTIFACTS, "results.json") }],
];
if (CI) reporter.push(["github"]);

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  outputDir: join(ARTIFACTS, "test-results"),
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    timezoneId: "UTC",
    locale: "en-US",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Fixtures first (they are deleted and recreated), then the preview build, then the server, which only answers
    // RPCs whose cwd lies inside the fixture root.
    command: "node e2e/fixtures.mjs && node preview/build.mjs && node preview/serve.mjs",
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { PORT: String(PORT), ALLOWED_ROOT: FIXTURE_ROOT, E2E_FIXTURE_ROOT: FIXTURE_ROOT },
  },
});
