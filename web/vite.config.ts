import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Module workers so the spreadsheet worker can lazy-load SheetJS.
  worker: { format: "es" },
  server: {
    // `pnpm dev` runs `wrangler dev` (worker/) on its default port alongside
    // Vite. The Worker will accept same-origin POSTs only, so present as its
    // origin.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        headers: { origin: "http://127.0.0.1:8787" },
      },
    },
  },
});
