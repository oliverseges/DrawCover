import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    alias: { "server-only": path.resolve(import.meta.dirname, "tests/unit/server-only-stub.ts") },
  },
});
