import { defineConfig, devices } from "@playwright/test";

const PORT = 4310;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", grepInvert: /@mobile|@screens/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "screens-desktop", grep: /@screens/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", grep: /@mobile|@screens/, use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `node tests/e2e/start-server.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/evaluate`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
