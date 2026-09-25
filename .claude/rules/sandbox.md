---
paths:
  - "web/src/sandbox/**"
  - "benchmark/src/adapters/**"
---
# Sandboxes (DuckDB-WASM, Pyodide) and their Node twins

## Interface (`packages/agent/src/sandbox.ts`)
`registerFile(name, bytes)`, `listTables()`, `describe(table)`, `sql(query, {timeoutMs, maxRows})`, `python(code, inputs, {timeoutMs})`, `getResult(id)`. Browser and Node adapters must pass the same contract tests (`packages/agent/src/sandbox.contract.ts`).

## DuckDB-WASM (browser)
- Pin `@duckdb/duckdb-wasm`. Load its bundles from jsDelivr with the library's bundle-selection helpers (the wasm files are too large for the 25 MiB static-asset limit), in its own Web Worker.
- Ingest CSV/TSV (`read_csv_auto`), Parquet, and JSON natively. XLSX goes through SheetJS CE → CSV in a worker; install SheetJS from its official CDN tarball as its docs describe (the npm `xlsx` package is stale). Sanitize table names derived from file names.
- Lock down at startup: turn off extension autoinstall and autoload. Accept only single statements that start with SELECT, WITH, FROM, SUMMARIZE, DESCRIBE, PIVOT, or UNPIVOT. Reject anything containing ATTACH, COPY, INSTALL, LOAD, EXPORT, IMPORT, PRAGMA, SET, CALL, CREATE, INSERT, UPDATE, DELETE, DROP, or a URL literal. This guard is the first line; CSP is the backstop.
- 10 s timeout via connection cancel; 20-row previews; results stored as Arrow.

## Pyodide (browser)
- Pinned version from jsDelivr, loaded lazily on the first `run_python`, in a dedicated Web Worker; packages: numpy and pandas only.
- Inputs arrive as Arrow or JSON and become DataFrames. A `result` DataFrame, if set, comes back as a new result id. stdout is captured and truncated to 2 KB.
- 15 s timeout enforced by terminating the worker (then recreate it lazily). No filesystem persistence.

## Node twins (benchmark harness)
`@duckdb/node-api` for SQL (same dialect) and Pyodide's Node build for Python. Same interface, same limits, same contract tests.

## Performance targets (measure and report; don't assume)
50 MB CSV: load + profile in < 5 s on a mid-range laptop; a typical aggregate query in < 300 ms.

