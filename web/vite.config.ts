import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Fails the build when the JS that first paint loads (the entry chunk and its static imports; lazy chunks don't count) passes `limitKb` gzipped. */
function jsBudget(limitKb: number): Plugin {
  return {
    name: "js-budget",
    apply: "build",
    generateBundle(_, bundle) {
      const seen = new Set<string>();
      let bytes = 0;
      const visit = (file: string) => {
        const chunk = bundle[file];
        if (seen.has(file) || chunk?.type !== "chunk") return;
        seen.add(file);
        bytes += gzipSync(chunk.code).length;
        chunk.imports.forEach(visit);
      };
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry) visit(file);
      }
      const summary = `First-paint JS: ${(bytes / 1024).toFixed(1)} KB gzipped in ${seen.size} files (budget ${limitKb} KB)`;
      if (bytes > limitKb * 1024) this.error(summary);
      console.log(summary);
    },
  };
}

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
  plugins: [react(), tailwindcss(), jsBudget(300)],
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
