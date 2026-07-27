import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run server",
      port: 8787,
      reuseExistingServer: true,
      timeout: 20_000,
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
      timeout: 20_000,
    },
  ],
});
