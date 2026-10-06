// End-to-end browser test (md/improve.md P1.20). Runs against a live stack:
//   CI:     docker compose up, then BASE_URL=http://localhost:8080 npm run e2e
//   local:  python tasks.py serve + npm run dev, then BASE_URL=http://localhost:5173 npm run e2e
// Locally, CHROME_PATH can point at an installed Chrome instead of downloading a browser.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
    screenshot: "only-on-failure",
  },
});
