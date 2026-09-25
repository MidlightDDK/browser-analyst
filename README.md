# Browser Analyst

A data-analyst agent that runs its code in your browser.

Drop a CSV, Excel, or Parquet file (or pick a sample) and ask a question. An LLM
agent plans, writes SQL (DuckDB-WASM) or Python (Pyodide), runs it in your
browser, recovers from its own errors, draws charts, and answers with numbers
traceable to the exact query that produced them. Your file never leaves your
browser: only schemas, small previews, and the conversation go to the model.

**Live:** https://browser-analyst.azar-majed7.workers.dev

## Status

The agent works end to end: open a sample or your own CSV, TSV,
Parquet, JSON, or Excel file, ask a question, and watch the agent plan, run SQL
and (after you approve it) Python in your browser, draw charts, recover from its
errors, and answer with numbers checked against the results that produced them.
Prompt-injection defenses and a red-team suite are in (M5); the benchmark
baseline (M4) and the live-model red-team numbers wait on free-tier quota. The
milestones are in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Agent

- **Results by reference, not by value.** Every query result stays in the
  browser (up to 100,000 rows each). The model sees only the columns, the row
  count, and at most 20 preview rows, and cites results by id (`r3`).
- **Checked numbers.** `final_answer` lists each key number with the result
  cell it came from (`r3.mean_mass`, row 0), and the app compares them,
  allowing for rounding. On a mismatch the model gets one chance to fix it;
  after that the answer carries a visible warning. Click a number to see its
  cell and the query behind it.
- **Charts without sending data.** `make_chart` takes a result id and a small
  Vega-Lite subset (mark and encoding, no data or URLs). The browser fills in
  the rows and draws it with vega-embed; the model only gets back a chart id.
- **Python on approval.** `run_python` runs pandas and numpy in Pyodide, in its
  own Web Worker, loaded on first use. Input results arrive as DataFrames, and
  a `result` DataFrame becomes a new result id that key numbers can cite. By
  default each run waits for a Run click; a run past 15 s is stopped by
  terminating the worker, and the next call starts a fresh one.
- **The loop** (`packages/agent/src/loop.ts`) stops on `final_answer`, on
  `ask_user`, at the step cap (8 by default, 12 at most), or after 3 failures
  in a row of the same tool. Each step sends the last 3 steps verbatim and one
  line per older step, within the gateway caps (24 messages, 24 KB, 4 KB per
  tool result).
- **The gateway** (`worker/`, a Cloudflare Worker) adds the system prompt and
  tool schemas server-side, requires a Turnstile-backed session, rate-limits,
  and streams one step at a time from free tiers: Gemini 3.5 Flash-Lite, then
  Gemini 3.8 Flash, Groq (Qwen 3.8 27B), and Workers AI (gpt-oss-120b). It falls
  through on 429, 5xx, or no first token within 8 s.
- **What the model saw:** a drawer shows the exact payload of the last step,
  plus the prompt and tool schemas the gateway adds.

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
  code in Node with `@duckdb/node-api` at the same engine version, and Pyodide
  314.0.7 in a worker thread. Both adapters share their logic
  (`packages/agent/src/duckdb-sandbox.ts`, `python.ts`) and pass the same
  20-case contract (`packages/agent/src/sandbox.contract.ts`): in vitest for
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

## Prompt-injection defenses and red team

A file is untrusted input: a cell, a column name, or the file name can carry
instructions aimed at the model. Five defenses, each behind a flag so the
red-team suite can measure it:

1. **Spotlighting** (`packages/agent/src/security/spotlight.ts`): the catalog
   and every tool result reach the model inside a `<data id="…">` block with a
   random per-run id, and the system prompt says a data block is never an
   instruction. Delimiter-like text inside the data is defanged, so a cell
   can't close the block early.
2. **Injection detector** (`detector.ts`): heuristics for instruction-like
   text, fake tool calls, role markers, URLs, image links, and HTML. A hit
   puts a ⚑ flag in the trace and a note after the data telling the model to
   ignore it. It flags none of the benchmark datasets' rows.
3. **Output sanitizer**: answers render without raw HTML or images, and links
   show as plain text with the full URL.
4. **SQL guard and engine lockdown** (above).
5. **CSP**: the page and its workers may only connect to this site, jsDelivr,
   and the DuckDB extension host. The Python and DuckDB workers forward their
   `securitypolicyviolation` events to the page, so blocked requests show in
   the trace ("Blocked by CSP: evil.example").

The red-team suite (`benchmark/redteam/`, `pnpm redteam`) runs 24 attack cases
and a control in Chromium against a local production build served with the
real headers. Playwright stands in for the gateway and records any request to
another origin that gets past the browser. `--model hijacked` swaps the LLM
for a scripted model that obeys every injection, which tests the defenses that
don't depend on the model; CI runs it on every push. Results:
[/security](https://browser-analyst.azar-majed7.workers.dev/security)
(from [web/public/security/latest.json](web/public/security/latest.json)).

Hijacked model (5 exfiltration cases plus the control, prompt-v3):

| Configuration | Blocked by CSP | Requests that left the browser |
| --- | --- | --- |
| All defenses on | 4 | **0** |
| Output sanitizer off | 5 | **0** |
| CSP off | 0 | 3 |
| All defenses off | 0 | 4 |

With CSP on, nothing left the browser in any configuration: Python's `fetch`,
EventSource, WebSocket, and synchronous XHR were all blocked and shown in the
trace. The SQL reads of remote files and the chart image were stopped earlier,
by the SQL guard, the engine lockdown, and the chart schema. Live-model attack
success rates are still to come: they wait on the free Gemini quota.

The "Try to hack it" card on the home page loads a sales file with three
injections hidden in its notes. Settings can turn each defense off (except
CSP, which is a response header) to show what it stops.

## Run locally

Needs Node 22+ and pnpm 10.

```bash
pnpm i
pnpm dev    # Vite on :5173 and wrangler dev on :8787; Vite proxies /api
```

Checks: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm e2e` ·
`pnpm redteam --model hijacked --defenses each` (no API keys needed).

## Tooling choices

- **Biome** for lint and format: one fast tool and one config instead of
  ESLint + Prettier (its formatter follows Prettier's style).
- **Vite + `wrangler dev` side by side**, with Vite proxying `/api`: the Worker
  stays a standalone package whose `wrangler.jsonc` also serves the built SPA
  in production, so dev and production share one Worker config.
- **vega-embed with `ast: true`** for charts: Vega then interprets its
  expressions instead of compiling them with `Function()`, so charts render
  under a CSP without `unsafe-eval`. It loads only when the first chart draws.

## Datasets and licenses

The UI samples live in [web/public/samples/](web/public/samples/). The
benchmark's datasets are listed in [benchmark/datasets.json](benchmark/datasets.json)
with pinned URLs and SHA-256 hashes; `pnpm bench:data` downloads, checks, and
derives them into `benchmark/data/` (not committed).

| Data | Source | License | Changes |
| --- | --- | --- | --- |
| `penguins.csv`, 344 rows (UI sample and benchmark) | [palmerpenguins](https://allisonhorst.github.io/palmerpenguins/) (Horst, Hill, Gorman), `inst/extdata/penguins.csv` | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `NA` written as empty (null) cells |
| `bike_sharing_hourly.parquet`, 17,379 rows (UI sample and benchmark) | [UCI Bike Sharing](https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset) (Fanaee-T, 2013), `hour.csv` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Converted to Parquet with DuckDB; values unchanged |
| `online_retail_week.xlsx` (UI sample) and `.csv` (benchmark), 16,985 rows | [UCI Online Retail](https://archive.ics.uci.edu/dataset/352/online+retail) (Chen, 2015), `Online Retail.xlsx` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Only rows with `InvoiceDate` from 1 to 7 December 2010; the benchmark copy goes through the app's own spreadsheet-to-CSV conversion |
| `wb_population.csv`, 17,195 rows (benchmark) | World Bank total population (SP.POP.TOTL) via [datasets/population](https://github.com/datasets/population) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (World Bank); packaging ODC-PDDL-1.0 | Unchanged; includes regional and income-group aggregates |
| `wb_gdp.csv`, 13,979 rows (benchmark) | World Bank GDP, current US$ (NY.GDP.MKTP.CD) via [datasets/gdp](https://github.com/datasets/gdp) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Unchanged; includes aggregates |
| `owid_co2.csv`, 18,984 rows (benchmark) | [Our World in Data CO2 and greenhouse gas emissions](https://github.com/owid/co2-data) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 13 of 79 columns, years 1950 onward; emissions from the Global Carbon Project (CC BY 4.0) |
| `hack_sales.csv`, 30 rows ("Try to hack it" sample) and the red-team files | Generated for this project (red-team files by [benchmark/redteam/cases.ts](benchmark/redteam/cases.ts)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Synthetic orders with planted prompt injections |
| `messy_orders.csv`, 614 rows (benchmark) | Generated by [benchmark/src/messy.ts](benchmark/src/messy.ts) (seeded) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Mixed date formats, blanks, inconsistent spellings, prices as text, 14 duplicate rows |

SHA-256 of each download and of each derived file is in `benchmark/datasets.json`.

## License

[MIT](LICENSE)
