import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests of the browser app against a mocked backend (tests/e2e/mockApi.ts).
 * Runs its own Vite server on 5174 so it never collides with `npm run dev` (5173),
 * and every /api and /auth request is intercepted in the browser, so the real
 * server and Google are never contacted. Uses the installed Chrome (no browser download).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    channel: "chrome",
    headless: true,
    viewport: { width: 1100, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
