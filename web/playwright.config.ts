import { defineConfig, devices } from "@playwright/test";

const port = 4173;
// E2E_BASE_URL points the suite at a deployed site instead of a local server.
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  // `*.e2e.ts` keeps these files out of vitest's default include pattern.
  testMatch: "**/*.e2e.ts",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "line",
  use: { baseURL: remote ?? `http://localhost:${port}` },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/perf.e2e.ts",
    },
    // Timings run alone, after the rest, so parallel engine downloads and
    // Python runs don't skew them.
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/perf.e2e.ts",
      dependencies: ["chromium"],
    },
  ],
  webServer: remote
    ? undefined
    : {
        command: `pnpm exec vite --port ${port} --strictPort`,
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
      },
});
