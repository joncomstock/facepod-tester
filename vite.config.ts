import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser must never talk to the FacePod directly — all /api calls are
// proxied to the Deno backend, which owns device communication over the local
// USB/FFI transport (HidFace.dll via Deno FFI).
const BACKEND_PORT = process.env.PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
