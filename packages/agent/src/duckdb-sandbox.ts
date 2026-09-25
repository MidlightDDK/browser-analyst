// Adapter-independent half of a DuckDB sandbox. Subclasses (DuckDB-WASM in the
// browser, @duckdb/node-api in the benchmark) supply the raw engine calls;
// everything the contract tests check (guard, limits, result store, ingestion
// naming, profiles) lives here so both behave the same.

import { quoteIdent, quoteString, truncateCell } from "./cells.ts";
import { loadSql, planIngest, type SheetCsv } from "./ingest.ts";
import { type Exec, profileTable } from "./profile.ts";
import {
  type Cell,
  type Column,
  DEFAULT_TIMEOUT_MS,
  ERROR_CHARS,
  MAX_RESULT_ROWS,
  PREVIEW_CELL_CHARS,
  PREVIEW_ROWS,
  type RegisteredTable,
  type Sandbox,
  type SqlOptions,
  type SqlResult,
  type StoredResult,
  type TableInfo,
  type TableProfile,
} from "./sandbox.ts";
import { guardSql } from "./security/sql-guard.ts";

/**
 * Settings applied once at startup (after the adapter loads the extensions it
 * needs): no extension downloads, no file or network access outside the
 * upload directory, and no further configuration changes.
 */
export function lockdownSql(uploadDir: string): string[] {
  return [
    "SET autoinstall_known_extensions = false",
    "SET autoload_known_extensions = false",
    `SET allowed_directories = [${quoteString(`${uploadDir}/`)}]`,
    "SET enable_external_access = false",
    "SET lock_configuration = true",
  ];
}

export interface CappedResult<H> {
  columns: Column[];
  /** Rows in `handle` (at most maxRows + 1: the extra row signals truncation). */
  rowCount: number;
  handle: H;
}

export class QueryTimeoutError extends Error {}

/** Caps a guarded query; newlines keep a trailing `--` comment from eating the `)`. */
export function capSql(sql: string, rows: number): string {
  return `SELECT * FROM (\n${sql}\n) LIMIT ${rows}`;
}

export abstract class DuckDBSandbox<H> implements Sandbox {
  /** Trusted, app-written SQL with canonical rows (no guard, no cap). */
  protected abstract exec(
    sql: string,
  ): Promise<{ columns: Column[]; rows: Cell[][] }>;
  /** Runs an already capped query; throws QueryTimeoutError after timeoutMs. */
  protected abstract runCapped(
    sql: string,
    timeoutMs: number,
  ): Promise<CappedResult<H>>;
  /** Canonical rows [start, end) of a stored result handle. */
  protected abstract rowsOf(handle: H, start: number, end: number): Cell[][];
  protected abstract putFile(path: string, bytes: Uint8Array): Promise<void>;
  protected abstract dropFile(path: string): Promise<void>;
  /** Directory for uploaded files; the engine can read nothing outside it. */
  protected abstract readonly uploadRoot: string;
  /** Spreadsheet conversion; the browser overrides it to use a worker. */
  protected toCsv?: (bytes: Uint8Array) => Promise<SheetCsv[]>;

  private readonly tables = new Map<string, RegisteredTable>();
  private readonly results = new Map<
    string,
    { columns: Column[]; rowCount: number; truncated: boolean; handle: H }
  >();
  private nextResult = 1;
  private nextFile = 1;
  private queue: Promise<unknown> = Promise.resolve();

  /** Runs engine work one call at a time. */
  protected serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  protected readonly trusted: Exec = (sql) => this.exec(sql);

  registerFile(name: string, bytes: Uint8Array): Promise<RegisteredTable[]> {
    return this.serial(async () => {
      const start = performance.now();
      const parts = await planIngest(
        name,
        bytes,
        new Set(this.tables.keys()),
        this.toCsv,
      );
      const loaded: RegisteredTable[] = [];
      for (const part of parts) {
        const path = `${this.uploadRoot}/f${this.nextFile++}.${part.format}`;
        await this.putFile(path, part.bytes);
        try {
          await this.exec(loadSql(part.table, path, part.format));
        } finally {
          await this.dropFile(path);
        }
        const t = quoteIdent(part.table);
        const { rows } = await this.exec(
          `SELECT (SELECT count(*) FROM ${t}) AS n, (SELECT count(*) FROM (DESCRIBE ${t})) AS c`,
        );
        const table: RegisteredTable = {
          table: part.table,
          rows: Number(rows[0]?.[0] ?? 0),
          columns: Number(rows[0]?.[1] ?? 0),
          source: part.source,
          format: part.format,
          loadMs: Math.round(performance.now() - start),
        };
        this.tables.set(table.table, table);
        loaded.push(table);
      }
      return loaded;
    });
  }

  async listTables(): Promise<TableInfo[]> {
    return [...this.tables.values()]
      .map(({ table, rows, columns }) => ({ table, rows, columns }))
      .sort((a, b) => a.table.localeCompare(b.table));
  }

  describe(table: string): Promise<TableProfile> {
    if (!this.tables.has(table))
      return Promise.reject(new Error(`Unknown table: ${table}`));
    return this.serial(() => profileTable(this.trusted, table));
  }

  /** Rows of a loaded table in insertion order, for the preview grid. */
  tableRows(table: string, offset: number, limit: number): Promise<Cell[][]> {
    if (!this.tables.has(table))
      return Promise.reject(new Error(`Unknown table: ${table}`));
    const sql = `SELECT * FROM ${quoteIdent(table)} LIMIT ${Math.max(0, Math.floor(limit))} OFFSET ${Math.max(0, Math.floor(offset))}`;
    return this.serial(async () => (await this.exec(sql)).rows);
  }

  sql(query: string, opts: SqlOptions = {}): Promise<SqlResult> {
    const guard = guardSql(query);
    if (!guard.ok)
      return Promise.resolve({
        error: `Rejected by the SQL guard: ${guard.reason}.`,
      });
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRows = Math.min(
      Math.max(1, opts.maxRows ?? MAX_RESULT_ROWS),
      MAX_RESULT_ROWS,
    );
    return this.serial(async () => {
      const start = performance.now();
      try {
        const res = await this.runCapped(
          capSql(guard.sql, maxRows + 1),
          timeoutMs,
        );
        const truncated = res.rowCount > maxRows;
        const rowCount = Math.min(res.rowCount, maxRows);
        const id = `r${this.nextResult++}`;
        this.results.set(id, {
          columns: res.columns,
          rowCount,
          truncated,
          handle: res.handle,
        });
        return {
          result_id: id,
          columns: res.columns,
          row_count: rowCount,
          preview: this.rowsOf(
            res.handle,
            0,
            Math.min(rowCount, PREVIEW_ROWS),
          ).map((r) => r.map((c) => truncateCell(c, PREVIEW_CELL_CHARS))),
          truncated,
          elapsed_ms: Math.round(performance.now() - start),
        };
      } catch (err) {
        if (err instanceof QueryTimeoutError)
          return {
            error: `The query timed out after ${timeoutMs / 1000} s and was cancelled. Aggregate or filter more.`,
          };
        const message = err instanceof Error ? err.message : String(err);
        return { error: message.slice(0, ERROR_CHARS) };
      }
    });
  }

  getResult(id: string): StoredResult | undefined {
    const r = this.results.get(id);
    if (!r) return undefined;
    return {
      id,
      columns: r.columns,
      rows: this.rowsOf(r.handle, 0, r.rowCount),
      truncated: r.truncated,
    };
  }

  abstract close(): Promise<void>;
}
