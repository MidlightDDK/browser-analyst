# Browser Analyst

A data-analyst agent that runs its code in your browser.

Drop a CSV, Excel, or Parquet file (or pick a sample) and ask a question. An LLM
agent plans, writes SQL (DuckDB-WASM) or Python (Pyodide), runs it in your
browser, recovers from its own errors, draws charts, and answers with numbers
traceable to the exact query that produced them. Your file never leaves your
browser: only schemas, small previews, and the conversation go to the model.

**Live:** https://browser-analyst.azar-majed7.workers.dev (placeholder for now)

## Status

Under construction. The scaffold (milestone M0) is deployed; the milestones are
in [docs/ROADMAP.md](docs/ROADMAP.md).

## Run locally

Needs Node 22+ and pnpm 10.

```bash
pnpm i
pnpm dev    # Vite on :5173 and wrangler dev on :8787; Vite proxies /api
```

Checks: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm e2e`.

## Tooling choices

- **Biome** for lint and format: one fast tool and one config instead of
  ESLint + Prettier (its formatter follows Prettier's style).
- **Vite + `wrangler dev` side by side**, with Vite proxying `/api`: the Worker
  stays a standalone package whose `wrangler.jsonc` also serves the built SPA
  in production, so dev and production share one Worker config.

## Datasets and licenses

None yet. Every dataset will be listed here with its source and license.

## License

[MIT](LICENSE)
