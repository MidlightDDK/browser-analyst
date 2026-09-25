import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The production headers (public/_headers has one `/*` block), so `vite preview` serves the build with the real CSP. */
function productionHeaders(): Record<string, string> {
  const text = readFileSync(
    new URL("public/_headers", import.meta.url),
    "utf8",
  );
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const m = /^\s+([\w-]+):\s*(.+)$/.exec(line);
      return m ? [[m[1], m[2]]] : [];
    }),
  );
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Module workers so the spreadsheet worker can lazy-load SheetJS.
  worker: { format: "es" },
  preview: { headers: productionHeaders() },
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
