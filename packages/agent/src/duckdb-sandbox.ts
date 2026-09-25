// Adapter-independent half of a DuckDB sandbox. Subclasses (DuckDB-WASM in the
// browser, @duckdb/node-api in the benchmark) supply the raw engine calls;
// everything the contract tests check (guard, limits, result store, ingestion
// naming, profiles) lives here so both behave the same.

import { quoteIdent, quoteString, truncateCell } from "./cells.ts";
import { loadSql, planIngest, type SheetCsv } from "./ingest.ts";
import { type Exec, profileTable } from "./profile.ts";
import {
  type PythonOutput,
  type PythonRunner,
  PythonTimeoutError,
} from "./python.ts";
import {
  type Cell,
  type Column,
  DEFAULT_TIMEOUT_MS,
  ERROR_CHARS,
  MAX_RESULT_ROWS,
  PREVIEW_CELL_CHARS,
  PREVIEW_ROWS,
  PYTHON_TIMEOUT_MS,
  type PythonOptions,
  type PythonResult,
  type RegisteredTable,
  type Sandbox,
  type SqlOptions,
  type SqlResult,
  STDOUT_CHARS,
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

/**
 * A DuckDB error as the model should see it: plain text in both engines
 * (DuckDB-WASM reports JSON), with line numbers of its own query rather than
 * of the capSql wrapper around it.
 */
export function cleanSqlError(raw: string): string {
  let msg = raw;
  try {
    const j = JSON.parse(raw) as {
      exception_type?: string;
      exception_message?: string;
    };
    if (typeof j?.exception_message === "string")
      msg = `${j.exception_type ?? "SQL"} Error: ${j.exception_message}`;
  } catch {
    // already plain text
  }
  msg = msg
    .replace(
      /LINE \d+: \) LIMIT \d+(\n *\^)?/g,
      "at the end of the query (an unclosed parenthesis or an unfinished expression?)",
    )
    .replace(
      /LINE (\d+):/g,
      (_, n: string) => `LINE ${Math.max(1, Number(n) - 1)}:`,
    );
  return msg.slice(0, ERROR_CHARS);
}

/** Keeps the end of a long Python error, where the exception is. */
const pythonError = (s: string) =>
  s.length > ERROR_CHARS ? `…${s.slice(-(ERROR_CHARS - 1))}` : s;

const preview = (rows: Cell[][]) =>
  rows
    .slice(0, PREVIEW_ROWS)
    .map((r) => r.map((c) => truncateCell(c, PREVIEW_CELL_CHARS)));

/** A stored result: an engine handle (SQL) or plain rows (Python). */
type Stored<H> = {
  columns: Column[];
  rowCount: number;
  truncated: boolean;
} & ({ handle: H } | { rows: Cell[][] });

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
  /** Pyodide in a worker; without it, python() reports Python as unavailable. */
  protected pythonRunner?: PythonRunner;

  private readonly tables = new Map<string, RegisteredTable>();
  private readonly results = new Map<string, Stored<H>>();
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
    const guard =
      opts.guard === false
        ? { ok: true as const, sql: query.trim().replace(/;+\s*$/, "") }
        : guardSql(query);
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
          preview: preview(
            this.rowsOf(res.handle, 0, Math.min(rowCount, PREVIEW_ROWS)),
          ),
          truncated,
          elapsed_ms: Math.round(performance.now() - start),
        };
      } catch (err) {
        if (err instanceof QueryTimeoutError)
          return {
            error: `The query timed out after ${timeoutMs / 1000} s and was cancelled. Aggregate or filter more.`,
          };
        return {
          error: cleanSqlError(
            err instanceof Error ? err.message : String(err),
          ),
        };
      }
    });
  }

  async python(
    code: string,
    inputIds: readonly string[],
    opts: PythonOptions = {},
  ): Promise<PythonResult> {
    const runner = this.pythonRunner;
    if (!runner)
      return { error: "Python isn't available in this sandbox.", stdout: "" };
    const ids = [...new Set(inputIds)];
    const unknown = ids.filter((id) => !this.results.has(id));
    if (unknown.length)
      return {
        error: `Unknown result id(s): ${unknown.join(", ")}. Pass result_ids returned by run_sql or run_python.`,
        stdout: "",
      };
    const inputs = ids.flatMap((id) => {
      const r = this.getResult(id);
      return r ? [{ id, columns: r.columns, rows: r.rows }] : [];
    });
    const timeoutMs = opts.timeoutMs ?? PYTHON_TIMEOUT_MS;
    const start = performance.now();
    let out: PythonOutput;
    try {
      out = await runner.run(
        { code, inputs, maxRows: MAX_RESULT_ROWS, stdoutChars: STDOUT_CHARS },
        timeoutMs,
      );
    } catch (err) {
      if (err instanceof PythonTimeoutError)
        return {
          error: `Python timed out after ${timeoutMs / 1000} s and was stopped. Avoid long loops: use vectorized pandas or numpy.`,
          stdout: "",
        };
      return {
        error: pythonError(
          `Python failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
        stdout: "",
      };
    }
    const stdout =
      out.stdout.length > STDOUT_CHARS + 60
        ? `${out.stdout.slice(0, STDOUT_CHARS)}…`
        : out.stdout;
    if (out.error !== undefined)
      return { error: pythonError(out.error), stdout };
    const base = {
      stdout,
      elapsed_ms: Math.round(performance.now() - start - (out.startupMs ?? 0)),
      ...(out.startupMs !== undefined ? { startup_ms: out.startupMs } : {}),
    };
    if (!out.result) return base;
    const { columns, rows, truncated } = out.result;
    const id = `r${this.nextResult++}`;
    this.results.set(id, { columns, rowCount: rows.length, truncated, rows });
    return {
      ...base,
      result_id: id,
      columns,
      row_count: rows.length,
      preview: preview(rows),
      truncated,
    };
  }

  getResult(id: string): StoredResult | undefined {
    const r = this.results.get(id);
    if (!r) return undefined;
    return {
      id,
      columns: r.columns,
      rows: "rows" in r ? r.rows : this.rowsOf(r.handle, 0, r.rowCount),
      truncated: r.truncated,
    };
  }

  /** Adapters close their engine, then call this. */
  protected async closePython(): Promise<void> {
    await this.pythonRunner?.close();
  }

  abstract close(): Promise<void>;
}
