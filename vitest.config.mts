import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the logic that decides what an operator is shown and what the
 * pipeline does — pure functions, no DOM, no network.
 *
 * Deliberately narrow: `next build` already integration-checks the app, and
 * `tsc --noEmit` already checks the types. What neither can check is a
 * judgement call, like "how long is a boot verdict worth trusting" or "which
 * box failure reasons are terminal". Those are what live here.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
