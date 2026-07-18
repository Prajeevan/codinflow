import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        // Your CodinFlow API — a local `wrangler dev` by default; set
        // CODINFLOW_API to develop against a deployed instance.
        target: process.env.CODINFLOW_API ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
