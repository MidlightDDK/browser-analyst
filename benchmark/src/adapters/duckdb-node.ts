// Node twin of the browser's DuckDB-WASM sandbox, for the benchmark harness.
// Same engine version (DuckDB 1.5.4), same shared logic (DuckDBSandbox), same
// contract tests. Python runs in a worker thread (pyodide-node.ts).

import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CappedResult,
  type Cell,
  type Column,
  canonicalType,
  DuckDBSandbox,
  lockdownSql,
  QueryTimeoutError,
  toCell,
} from "@browser-analyst/agent";
import {
  type DuckDBConnection,
  DuckDBInstance,
  type DuckDBResultReader,
} from "@duckdb/node-api";
import { nodePythonRunner } from "./pyodide-node.ts";

function canonical(reader: DuckDBResultReader): {
  columns: Column[];
  rows: Cell[][];
} {
  const columns = reader.columnNames().map((name, i) => ({
    name,
    type: canonicalType(reader.columnType(i).toString()),
  }));
  const rows = reader
    .getRowsJS()
    .map((row) => row.map((v, i) => toCell(v, columns[i]?.type ?? "")));
  return { columns, rows };
}

export class NodeDuckDBSandbox extends DuckDBSandbox<Cell[][]> {
  protected readonly uploadRoot: string;
  private readonly instance: DuckDBInstance;
  private readonly conn: DuckDBConnection;

  private constructor(
    instance: DuckDBInstance,
    conn: DuckDBConnection,
    uploadRoot: string,
  ) {
    super();
    this.instance = instance;
    this.conn = conn;
    this.uploadRoot = uploadRoot;
  }

  static async create(): Promise<NodeDuckDBSandbox> {
    // Forward slashes keep the allowed_directories prefix match simple on Windows.
    const root = (await mkdtemp(join(tmpdir(), "browser-analyst-"))).replaceAll(
      "\\",
      "/",
    );
    // One thread, like DuckDB-WASM's jsDelivr bundles: row order (ties,
    // unordered GROUP BY) is then the same every run, so tool results and the
    // benchmark's cache keys are reproducible.
    const instance = await DuckDBInstance.create(":memory:", { threads: "1" });
    const conn = await instance.connect();
    for (const sql of lockdownSql(root)) await conn.run(sql);
    const sandbox = new NodeDuckDBSandbox(instance, conn, root);
    sandbox.pythonRunner = nodePythonRunner();
    return sandbox;
  }

  protected async exec(sql: string) {
    return canonical(await this.conn.runAndReadAll(sql));
  }

  protected async runCapped(
    sql: string,
    timeoutMs: number,
  ): Promise<CappedResult<Cell[][]>> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.conn.interrupt();
    }, timeoutMs);
    try {
      const { columns, rows } = canonical(await this.conn.runAndReadAll(sql));
      return { columns, rowCount: rows.length, handle: rows };
    } catch (err) {
      if (timedOut) throw new QueryTimeoutError();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  protected rowsOf(handle: Cell[][], start: number, end: number): Cell[][] {
    return handle.slice(start, end);
  }

  protected putFile(path: string, bytes: Uint8Array): Promise<void> {
    return writeFile(path, bytes);
  }

  protected dropFile(path: string): Promise<void> {
    return unlink(path);
  }

  async close(): Promise<void> {
    this.conn.closeSync();
    this.instance.closeSync();
    await this.closePython();
    await rm(this.uploadRoot, { recursive: true, force: true });
  }
}
