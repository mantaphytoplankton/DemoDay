import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/shared/**", "src/components/**", "src/hooks/**", "src/i18n/**"],
      exclude: ["src/server/testing/**"],
      reporter: ["text-summary", "text"],
    },
  },
});
