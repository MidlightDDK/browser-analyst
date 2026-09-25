// The sandbox interface the agent runs its tools through. The browser adapter
// (web/src/sandbox/, DuckDB-WASM) and the Node twin (benchmark/src/adapters/,
// @duckdb/node-api) implement it and must pass sandbox.contract.ts.
// Python (run_python) joins this interface in M3.

import type { FileFormat } from "./ingest.ts";

/** A result cell in canonical form: same value in every adapter. */
export type Cell = string | number | boolean | null;

export interface Column {
  name: string;
  /** Canonical DuckDB type label (see canonicalType). */
  type: string;
}

export interface TableInfo {
  table: string;
  rows: number;
  columns: number;
}

export interface RegisteredTable extends TableInfo {
  /** The uploaded file (and sheet, for spreadsheets) the table came from. */
  source: string;
  format: FileFormat;
  loadMs: number;
}

export interface ColumnProfile {
  name: string;
  type: string;
  null_pct: number;
  approx_distinct: number;
  min: Cell;
  max: Cell;
  /** Up to 5 frequent values (approximate), for text and low-cardinality columns. */
  top_values: Cell[];
}

export interface TableProfile {
  table: string;
  rows: number;
  columns: ColumnProfile[];
  /** 3 rows in column order, text cut to 60 chars. */
  sample_rows: Cell[][];
}

export interface SqlOptions {
  timeoutMs?: number;
  /** Rows kept in the result store (capped at MAX_RESULT_ROWS). */
  maxRows?: number;
}

export interface SqlSuccess {
  result_id: string;
  columns: Column[];
  /** Rows stored under result_id. */
  row_count: number;
  /** First PREVIEW_ROWS rows, long text cut to PREVIEW_CELL_CHARS. */
  preview: Cell[][];
  /** True when the query produced more rows than were stored. */
  truncated: boolean;
  elapsed_ms: number;
}

export interface SqlFailure {
  error: string;
}

export type SqlResult = SqlSuccess | SqlFailure;

export interface StoredResult {
  id: string;
  columns: Column[];
  rows: Cell[][];
  truncated: boolean;
}

export interface Sandbox {
  /** Loads a file as one table (one per sheet for spreadsheets). */
  registerFile(name: string, bytes: Uint8Array): Promise<RegisteredTable[]>;
  listTables(): Promise<TableInfo[]>;
  describe(table: string): Promise<TableProfile>;
  /** Runs model-written SQL through the guard, a timeout, and the row cap. */
  sql(query: string, opts?: SqlOptions): Promise<SqlResult>;
  getResult(id: string): StoredResult | undefined;
  close(): Promise<void>;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_RESULT_ROWS = 100_000;
export const PREVIEW_ROWS = 20;
export const PREVIEW_CELL_CHARS = 200;
export const ERROR_CHARS = 500;
