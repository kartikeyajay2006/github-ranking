import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": here("./src"),
      "server-only": here("./tests/support/empty.ts"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 120_000 },
});
