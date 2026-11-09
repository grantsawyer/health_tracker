import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Runs before each test file: points HEALTH_TRACKER_HOME at a fresh temp dir
    // so tests never touch ~/.health_tracker (tokens, cache, favorites, queue).
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
