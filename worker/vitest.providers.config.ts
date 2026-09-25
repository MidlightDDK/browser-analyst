import { defineConfig } from "vitest/config";

// `pnpm test:providers`: live provider contract tests (not part of `pnpm test`).
export default defineConfig({
  test: {
    include: ["src/**/*.contract.ts"],
    testTimeout: 90_000,
  },
});
