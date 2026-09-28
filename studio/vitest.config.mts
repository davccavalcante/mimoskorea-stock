import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/live/**/*.live.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    pool: "forks",
  },
});
