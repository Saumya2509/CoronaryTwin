import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@fixtures": fixtures } },
  server: {
    port: 5173,
    fs: { allow: [".", fixtures] },
    // Same-origin API calls in development: /api/predict -> http://127.0.0.1:8000/predict
    proxy: {
      // Override with API_TARGET=http://127.0.0.1:8010 if port 8000 is taken.
      "/api": { target: process.env.API_TARGET ?? "http://127.0.0.1:8000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] }, // e2e/ runs under Playwright
});
