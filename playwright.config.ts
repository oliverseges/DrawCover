import { defineConfig } from "@playwright/test";

const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: external ?? "http://localhost:3100" },
  // E2E_BASE_URL reuses an already running dev server (Next allows one dev server per directory).
  webServer: external
    ? undefined
    : {
        command: "npm run dev -- -p 3100",
        url: "http://localhost:3100",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
