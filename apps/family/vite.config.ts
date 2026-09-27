import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname),
  base: "./",
  plugins: [react()],
  build: { outDir: resolve(__dirname, "../../dist/family"), emptyOutDir: true },
  server: {
    port: 5175,
    proxy: { "/api": "http://localhost:8795", "/media": "http://localhost:8795" },
  },
});
