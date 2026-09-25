# Browser Analyst

A data-analyst agent that runs its code in your browser.

Drop a CSV, Excel, or Parquet file (or pick a sample) and ask a question. An LLM
agent plans, writes SQL (DuckDB-WASM) or Python (Pyodide), runs it in your
browser, recovers from its own errors, draws charts, and answers with numbers
traceable to the exact query that produced them. Your file never leaves your
browser: only schemas, small previews, and the conversation go to the model.

**Live:** https://browser-analyst.azar-majed7.workers.dev

## Status

The data layer (milestone M1) is live: open a sample or your own CSV, TSV,
Parquet, JSON, or Excel file, and DuckDB-WASM loads and profiles it inside the
tab. The agent comes next; the milestones are in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Data layer

- **DuckDB-WASM in a Web Worker**, pinned (`@duckdb/duckdb-wasm` 1.33.1-dev57.0,
  DuckDB 1.5.4) and loaded from jsDelivr on the first file, so first paint never
  waits for it. Excel files go through SheetJS CE in a separate worker, one
  table per sheet, with dates converted to ISO text.
- **Profiles** come from DuckDB `SUMMARIZE` plus `approx_top_k`: type, null
  share, approximate distinct count, min, max, frequent values, and 3 sample
  rows. The preview grid is virtualized and pages rows from DuckDB, so a
  750,000-row table scrolls like a small one.
- **One adapter contract, two engines.** The benchmark will run the same agent
  code in Node with `@duckdb/node-api` at the same engine version. Both adapters
  share their logic (`packages/agent/src/duckdb-sandbox.ts`) and pass the same
  15-case contract (`packages/agent/src/sandbox.contract.ts`): in vitest for
  Node, and in Chromium through Playwright for the browser.

| Measurement (M1 acceptance) | Result |
| --- | --- |
| 50 MB CSV (763,577 rows × 8 columns): load + profile | **1.82 s**, median of 3 (load 0.91 s, profile 0.92 s); target < 5 s |
| Same file under the production CSP (`wrangler dev`) | 1.83 s |
| Same file on the live site | 2.26 s |
| Same file in CI (GitHub Actions `ubuntu-latest`) | 1.90 s |

Measured by `web/e2e/perf.e2e.ts` in headless Chromium (Playwright 1.63) on an
Intel Core i5-10300H laptop with 24 GB of RAM, after the engine had started.
A first visit also downloads the engine, which took 4–6 s on a cold cache.

### Guarding model-written SQL

Every query the agent writes passes three layers:

1. **Statement guard** (`packages/agent/src/security/sql-guard.ts`, 65 unit
   cases): one statement that starts with SELECT, WITH, FROM, SUMMARIZE,
   DESCRIBE, PIVOT, or UNPIVOT; no DDL, DML, ATTACH, COPY, INSTALL, LOAD,
   PRAGMA, SET, or CALL; no URL literals; no file-reading table functions
   (`read_csv`, `glob`, `query`, …) and no `FROM 'file'` scans, because the app
   has already loaded the tables.
2. **Engine lockdown at startup**: extension autoload and autoinstall off, file
   access limited to the upload directory (`allowed_directories` with
   `enable_external_access = false`), then `lock_configuration = true`. Each
   uploaded file is dropped from the virtual file system once it is loaded.
3. **CSP** as the browser backstop: `connect-src` allows only this site,
   jsDelivr, and `extensions.duckdb.org` (DuckDB-WASM fetches its signed
   Parquet and JSON extensions from there once, before the lockdown).

Queries also get a 10 s timeout (cancelled through the connection) and a
100,000-row cap on stored results; the model sees 20-row previews.

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

The samples live in [web/public/samples/](web/public/samples/).

| Sample | Source | License | Changes |
| --- | --- | --- | --- |
| `penguins.csv`, 344 rows | [palmerpenguins](https://allisonhorst.github.io/palmerpenguins/) (Horst, Hill, Gorman), `inst/extdata/penguins.csv` | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `NA` written as empty (null) cells |
| `bike_sharing_hourly.parquet`, 17,379 rows | [UCI Bike Sharing](https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset) (Fanaee-T, 2013), `hour.csv` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Converted to Parquet with DuckDB; values unchanged |
| `online_retail_week.xlsx`, 16,985 rows | [UCI Online Retail](https://archive.ics.uci.edu/dataset/352/online+retail) (Chen, 2015), `Online Retail.xlsx` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Only rows with `InvoiceDate` from 1 to 7 December 2010, rewritten with SheetJS |

SHA-256 of the source files as downloaded (2026-09-25):

- `penguins.csv`: `f204db2c753b0937caac3cb35258562c14f073e4bbc76be24b4c51ce22767a93`
- `hour.csv`: `e03de4ee4ef4dc376ac6e04bf829673c6269e8eba5c60fa121640fa2f829504f`
- `Online Retail.xlsx`: `43465a06f2ccf7c8b5bd2892bc7defb52f97487934fe93b16ae4c3936424676d`

The benchmark milestone (M4) scripts these downloads and checks.

## License

[MIT](LICENSE)
