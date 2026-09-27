import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base "./" so the build loads from Android's asset loader as well as from /tv/ on the server.
export default defineConfig({
  root: resolve(__dirname),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "../../dist/tv"),
    emptyOutDir: true,
    // Fire OS 7 and 8 ship Chromium-based WebViews; this keeps the output inside what they run.
    target: "chrome79",
  },
  server: {
    port: 5174,
    proxy: { "/api": "http://localhost:8795", "/media": "http://localhost:8795" },
  },
});
