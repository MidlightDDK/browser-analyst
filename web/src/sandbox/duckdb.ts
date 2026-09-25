// DuckDB-WASM sandbox. The engine runs in its own Web Worker, loaded from
// jsDelivr (the wasm files exceed the 25 MiB static-asset limit); the pinned
// npm version decides the CDN URLs. Parquet and JSON are extensions that
// DuckDB-WASM fetches from extensions.duckdb.org, so they load before lockdown.

import {
  type CappedResult,
  type Cell,
  type Column,
  DuckDBSandbox,
  lockdownSql,
  QueryTimeoutError,
  type SheetCsv,
  toCell,
} from "@browser-analyst/agent";
import * as duckdb from "@duckdb/duckdb-wasm";
import {
  type Table as ArrowTable,
  type DataType,
  DataType as DT,
  type Float,
  Precision,
  Table,
} from "apache-arrow";
import { CSP_FORWARD_JS } from "./csp-forward";
import { browserPythonRunner } from "./pyodide";

const UPLOAD_ROOT = "uploads";

/** The DuckDB type label for an Arrow type (see canonicalType in packages/agent). */
export function arrowTypeLabel(type: DataType): string {
  if (DT.isInt(type)) {
    const name = (
      { 8: "TINYINT", 16: "SMALLINT", 32: "INTEGER", 64: "BIGINT" } as const
    )[type.bitWidth];
    return type.isSigned ? name : `U${name}`;
  }
  if (DT.isFloat(type))
    return (type as Float).precision === Precision.DOUBLE ? "DOUBLE" : "FLOAT";
  if (DT.isDecimal(type)) return "DOUBLE";
  if (DT.isUtf8(type) || DT.isLargeUtf8(type)) return "VARCHAR";
  if (DT.isBool(type)) return "BOOLEAN";
  // castTimestampToDate turns TIMESTAMP into millisecond dates.
  if (DT.isDate(type)) return type.unit === 0 ? "DATE" : "TIMESTAMP";
  if (DT.isTimestamp(type)) return "TIMESTAMP";
  if (DT.isTime(type)) return "TIME";
  if (DT.isInterval(type) || DT.isDuration(type)) return "INTERVAL";
  if (DT.isBinary(type) || DT.isLargeBinary(type) || DT.isFixedSizeBinary(type))
    return "BLOB";
  if (DT.isList(type) || DT.isFixedSizeList(type)) return "LIST";
  if (DT.isStruct(type)) return "STRUCT";
  if (DT.isMap(type)) return "MAP";
  if (DT.isDictionary(type)) return arrowTypeLabel(type.dictionary);
  if (DT.isNull(type)) return "NULL";
  return String(type).toUpperCase();
}

function columnsOf(table: ArrowTable): Column[] {
  return table.schema.fields.map((f) => ({
    name: f.name,
    type: arrowTypeLabel(f.type),
  }));
}

function rowsOf(
  table: ArrowTable,
  columns: Column[],
  start: number,
  end: number,
): Cell[][] {
  const slice = table.slice(start, end);
  const rows: Cell[][] = Array.from(
    { length: slice.numRows },
    () => new Array(columns.length),
  );
  columns.forEach((col, c) => {
    const vector = slice.getChildAt(c);
    if (!vector) return;
    for (let r = 0; r < slice.numRows; r++)
      (rows[r] as Cell[])[c] = toCell(vector.get(r), col.type);
  });
  return rows;
}

function xlsxInWorker(bytes: Uint8Array): Promise<SheetCsv[]> {
  const worker = new Worker(new URL("./xlsx.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<SheetCsv[]>((resolve, reject) => {
    worker.onmessage = (
      e: MessageEvent<{ sheets: SheetCsv[] } | { error: string }>,
    ) =>
      "error" in e.data
        ? reject(new Error(e.data.error))
        : resolve(e.data.sheets);
    worker.onerror = (e) =>
      reject(new Error(e.message || "Spreadsheet conversion failed"));
    worker.postMessage(bytes);
  }).finally(() => worker.terminate());
}

interface Handle {
  table: ArrowTable;
  columns: Column[];
}

export class BrowserDuckDBSandbox extends DuckDBSandbox<Handle> {
  protected readonly uploadRoot = UPLOAD_ROOT;
  private readonly db: duckdb.AsyncDuckDB;
  private readonly conn: duckdb.AsyncDuckDBConnection;
  /** DuckDB engine version, e.g. v1.5.4. */
  readonly version: string;

  private constructor(
    db: duckdb.AsyncDuckDB,
    conn: duckdb.AsyncDuckDBConnection,
    version: string,
  ) {
    super();
    this.db = db;
    this.conn = conn;
    this.version = version;
    this.toCsv = xlsxInWorker;
    // Pyodide itself loads on the first run_python.
    this.pythonRunner = browserPythonRunner();
  }

  static async create(): Promise<BrowserDuckDBSandbox> {
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    if (!bundle.mainWorker)
      throw new Error("No DuckDB-WASM worker for this browser");
    // A same-origin blob worker that pulls the CDN script (cross-origin
    // workers are not allowed) after hooking up CSP-violation forwarding.
    const workerUrl = URL.createObjectURL(
      new Blob(
        [
          `${CSP_FORWARD_JS}\nimportScripts(${JSON.stringify(bundle.mainWorker)});`,
        ],
        { type: "text/javascript" },
      ),
    );
    const db = new duckdb.AsyncDuckDB(
      new duckdb.VoidLogger(),
      new Worker(workerUrl),
    );
    try {
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    } finally {
      URL.revokeObjectURL(workerUrl);
    }
    await db.open({
      query: { castDecimalToDouble: true, castTimestampToDate: true },
    });
    const conn = await db.connect();
    for (const sql of [
      "LOAD parquet",
      "LOAD json",
      ...lockdownSql(UPLOAD_ROOT),
    ])
      await conn.query(sql);
    const version = String(
      (await conn.query("SELECT version() AS v")).getChildAt(0)?.get(0),
    );
    return new BrowserDuckDBSandbox(db, conn, version);
  }

  protected async exec(sql: string) {
    const table = await this.conn.query(sql);
    const columns = columnsOf(table);
    return { columns, rows: rowsOf(table, columns, 0, table.numRows) };
  }

  protected async runCapped(
    sql: string,
    timeoutMs: number,
  ): Promise<CappedResult<Handle>> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void this.conn.cancelSent();
    }, timeoutMs);
    try {
      // send() polls a pending query, which is what makes cancelSent() work.
      const reader = await this.conn.send(sql, false);
      const batches = [];
      for await (const batch of reader) batches.push(batch);
      const table = new Table(reader.schema, batches);
      const columns = columnsOf(table);
      return { columns, rowCount: table.numRows, handle: { table, columns } };
    } catch (err) {
      if (timedOut) throw new QueryTimeoutError();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  protected rowsOf(handle: Handle, start: number, end: number): Cell[][] {
    return rowsOf(handle.table, handle.columns, start, end);
  }

  protected putFile(path: string, bytes: Uint8Array): Promise<void> {
    // registerFileBuffer transfers the buffer to the worker; copy so callers keep theirs.
    return this.db.registerFileBuffer(path, bytes.slice());
  }

  protected async dropFile(path: string): Promise<void> {
    await this.db.dropFile(path);
  }

  async close(): Promise<void> {
    await this.conn.close();
    await this.db.terminate();
    await this.closePython();
  }
}
