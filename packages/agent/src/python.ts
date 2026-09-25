// Python for run_python: one Pyodide per worker (a Web Worker in the browser,
// a worker thread in the Node twin). This module holds everything both share:
// the Python harness, the worker message protocol, and the runner that
// enforces the timeout by terminating the worker and starting a new one on the
// next call. The worker never sees the DuckDB engine: inputs arrive as plain
// columns and results come back the same way.

import type { Cell, Column } from "./sandbox.ts";

/** Pinned Pyodide release; the web app loads it from jsDelivr, Node from npm. */
export const PYODIDE_VERSION = "314.0.7";
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PYTHON_PACKAGES = ["numpy", "pandas"];
/** Startup (download, compile, packages) is not part of the run timeout. */
export const PYTHON_STARTUP_TIMEOUT_MS = 180_000;

export class PythonTimeoutError extends Error {}

export interface PythonInput {
  id: string;
  columns: Column[];
  rows: Cell[][];
}

export interface PythonRequest {
  code: string;
  inputs: PythonInput[];
  maxRows: number;
  stdoutChars: number;
}

export interface PythonOutput {
  stdout: string;
  /** The user code raised (or `result` couldn't become a table). */
  error?: string;
  result?: { columns: Column[]; rows: Cell[][]; truncated: boolean };
  /** Set on the call that started Python. */
  startupMs?: number;
}

export interface PythonRunner {
  /** Rejects with PythonTimeoutError when the code runs past timeoutMs. */
  run(req: PythonRequest, timeoutMs: number): Promise<PythonOutput>;
  close(): Promise<void>;
}

/** The slice of the Pyodide API the harness needs. */
export interface PyodideLike {
  loadPackage(
    names: string[],
    options?: { messageCallback?: (msg: string) => void },
  ): Promise<unknown>;
  runPython(code: string): unknown;
  globals: { get(name: string): unknown };
}

// Runs inside Pyodide. Kept free of backticks and dollar-brace so it can live
// in a raw template string.
const PY_HARNESS = String.raw`
import datetime, io, json, linecache, math, sys, traceback
import numpy as np
import pandas as pd

_SRC = "<python>"
_SAFE_INT = 2 ** 53
_NUMERIC = {"TINYINT", "SMALLINT", "INTEGER", "BIGINT", "UTINYINT", "USMALLINT",
            "UINTEGER", "UBIGINT", "FLOAT", "DOUBLE"}


class _Capped(io.TextIOBase):
    def __init__(self, limit):
        self.parts, self.size, self.cut, self.limit = [], 0, 0, limit

    def writable(self):
        return True

    def write(self, s):
        room = max(0, self.limit - self.size)
        self.parts.append(s[:room])
        self.size += min(room, len(s))
        self.cut += max(0, len(s) - room)
        return len(s)

    def text(self):
        out = "".join(self.parts)
        return out + ("\n... [%d more characters cut]" % self.cut if self.cut else "")


def _series(values, typ):
    if typ in ("DATE", "TIMESTAMP"):
        return pd.to_datetime(pd.Series(values, dtype=object), errors="coerce", format="ISO8601")
    if not values:
        return pd.Series(values, dtype="float64" if typ in _NUMERIC else "bool" if typ == "BOOLEAN" else object)
    return pd.Series(values)


def _frame(t):
    df = pd.DataFrame({i: _series(v, c["type"]) for i, (c, v) in enumerate(zip(t["columns"], t["data"]))})
    df.columns = [c["name"] for c in t["columns"]]
    return df


def _cell(v):
    if v is None or isinstance(v, str):
        return v
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        v = int(v)
        return v if -_SAFE_INT <= v <= _SAFE_INT else str(v)
    if isinstance(v, (float, np.floating)):
        v = float(v)
        if math.isnan(v):
            return None
        return v if math.isfinite(v) else ("Infinity" if v > 0 else "-Infinity")
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, datetime.datetime):
        ts = pd.Timestamp(v)
        if ts.tzinfo is not None:
            ts = ts.tz_convert("UTC").tz_localize(None)
        ms = ts.microsecond // 1000
        return ts.strftime("%Y-%m-%d %H:%M:%S") + (".%03d" % ms if ms else "")
    if isinstance(v, datetime.date):
        return v.isoformat()
    return str(v)


def _column(s):
    if pd.api.types.is_datetime64_any_dtype(s.dtype):
        if s.dt.tz is not None:
            s = s.dt.tz_convert("UTC").dt.tz_localize(None)
        present = s.dropna()
        if bool((present == present.dt.normalize()).all()):
            return "DATE", [None if pd.isna(v) else v.strftime("%Y-%m-%d") for v in s.tolist()]
        return "TIMESTAMP", [_cell(v) for v in s.tolist()]
    cells = [_cell(v) for v in s.tolist()]
    if pd.api.types.is_bool_dtype(s.dtype):
        return "BOOLEAN", cells
    if pd.api.types.is_integer_dtype(s.dtype):
        return "BIGINT", cells
    if pd.api.types.is_float_dtype(s.dtype):
        return "DOUBLE", cells
    present = [c for c in cells if c is not None]
    if present and all(isinstance(c, bool) for c in present):
        return "BOOLEAN", cells
    if present and all(isinstance(c, int) and not isinstance(c, bool) for c in present):
        return "BIGINT", cells
    if present and all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in present):
        return "DOUBLE", cells
    return "VARCHAR", [c if c is None or isinstance(c, str) else str(c) for c in cells]


def _table(obj, max_rows):
    if isinstance(obj, pd.Series):
        obj = obj.to_frame(name="value" if obj.name is None else obj.name)
    elif not isinstance(obj, pd.DataFrame):
        if isinstance(obj, (dict, list, tuple, np.ndarray)):
            try:
                obj = pd.DataFrame(obj)
            except ValueError:
                obj = pd.DataFrame([obj])
        else:
            obj = pd.DataFrame({"result": [obj]})
    df = obj
    if isinstance(df.index, pd.MultiIndex) or df.index.name is not None:
        try:
            df = df.reset_index()
        except ValueError:
            df = df.reset_index(drop=True)
    if isinstance(df.columns, pd.MultiIndex):
        names = ["_".join(str(p) for p in c if str(p) != "") for c in df.columns]
    else:
        names = [str(c) for c in df.columns]
    truncated = len(df) > max_rows
    df = df.iloc[:max_rows]
    columns, data = [], []
    for i, name in enumerate(names):
        typ, cells = _column(df.iloc[:, i])
        columns.append({"name": name, "type": typ})
        data.append(cells)
    return {"columns": columns, "data": data, "truncated": truncated}


def _error(e):
    only = "".join(traceback.format_exception_only(type(e), e)).strip()
    if isinstance(e, SyntaxError):
        return only
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == _SRC]
    if not frames:
        return only
    return "Traceback (most recent call last):\n" + "".join(traceback.format_list(frames[-3:])) + only


def _browser_analyst_run(payload):
    req = json.loads(payload)
    frames = {t["id"]: _frame(t) for t in req["inputs"]}
    ns = {"__name__": "__main__", "pd": pd, "np": np, "inputs": frames}
    ns.update(frames)
    if len(frames) == 1:
        ns["df"] = next(iter(frames.values()))
    code = req["code"]
    linecache.cache[_SRC] = (len(code), None, code.splitlines(True), _SRC)
    out = _Capped(req["stdout_chars"])
    resp = {}
    saved = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    try:
        exec(compile(code, _SRC, "exec"), ns)
    except BaseException as e:
        resp["error"] = _error(e)
    finally:
        sys.stdout, sys.stderr = saved
    if "error" not in resp and ns.get("result") is not None:
        try:
            resp["result"] = _table(ns["result"], req["max_rows"])
        except Exception as e:
            resp["error"] = "result could not be turned into a table: %s: %s" % (type(e).__name__, e)
    resp["stdout"] = out.text()
    return json.dumps(resp, default=str)
`;

/** Loads the packages and defines the harness in a fresh Pyodide. */
export async function preparePyodide(py: PyodideLike): Promise<void> {
  await py.loadPackage(PYTHON_PACKAGES, { messageCallback: () => {} });
  py.runPython(PY_HARNESS);
}

interface WireTable {
  columns: Column[];
  /** Column-major cells. */
  data: Cell[][];
  truncated: boolean;
}

const toColumns = (columns: Column[], rows: Cell[][]): Cell[][] =>
  columns.map((_, c) => rows.map((r) => r[c] ?? null));

const toRows = (t: WireTable): Cell[][] =>
  Array.from({ length: t.data[0]?.length ?? 0 }, (_, r) =>
    t.data.map((col) => col[r] ?? null),
  );

/** Runs one request in a prepared Pyodide (inside the worker). */
export function runInPyodide(
  py: PyodideLike,
  req: PythonRequest,
): PythonOutput {
  const fn = py.globals.get("_browser_analyst_run") as ((
    payload: string,
  ) => string) & { destroy?: () => void };
  try {
    const raw = JSON.parse(
      fn(
        JSON.stringify({
          code: req.code,
          inputs: req.inputs.map((t) => ({
            id: t.id,
            columns: t.columns,
            data: toColumns(t.columns, t.rows),
          })),
          max_rows: req.maxRows,
          stdout_chars: req.stdoutChars,
        }),
      ),
    ) as { stdout: string; error?: string; result?: WireTable };
    return {
      stdout: raw.stdout,
      ...(raw.error !== undefined ? { error: raw.error } : {}),
      ...(raw.result
        ? {
            result: {
              columns: raw.result.columns,
              rows: toRows(raw.result),
              truncated: raw.result.truncated,
            },
          }
        : {}),
    };
  } finally {
    fn.destroy?.();
  }
}

// ---------------------------------------------------------------- worker protocol

export type PythonWorkerRequest =
  | { id: number; kind: "start" }
  | { id: number; kind: "run"; req: PythonRequest };

export type PythonWorkerResponse =
  | { id: number; ok: true; out?: PythonOutput; startupMs?: number }
  | { id: number; ok: false; error: string };

/** Worker side: answers one message, starting Python on first use. */
export async function handlePythonMessage(
  msg: PythonWorkerRequest,
  load: () => Promise<PyodideLike>,
): Promise<PythonWorkerResponse> {
  try {
    const t0 = performance.now();
    const py = await load();
    if (msg.kind === "start")
      return {
        id: msg.id,
        ok: true,
        startupMs: Math.round(performance.now() - t0),
      };
    return { id: msg.id, ok: true, out: runInPyodide(py, msg.req) };
  } catch (err) {
    return {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface PythonPort {
  post(msg: PythonWorkerRequest): void;
  terminate(): void;
}

/** Starts a worker; the adapter wires its messages and crashes to these callbacks. */
export type SpawnPython = (
  onMessage: (msg: PythonWorkerResponse) => void,
  onError: (err: Error) => void,
) => PythonPort;

/**
 * Runs Python in a worker, one call at a time. A run past its timeout
 * terminates the worker (the only way to stop a busy interpreter); the next
 * call starts a new one.
 */
export class WorkerPythonRunner implements PythonRunner {
  private readonly spawn: SpawnPython;
  private readonly startupTimeoutMs: number;
  private port: PythonPort | null = null;
  private starting: Promise<number> | null = null;
  private readonly pending = new Map<
    number,
    (res: PythonWorkerResponse | Error) => void
  >();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    spawn: SpawnPython,
    startupTimeoutMs = PYTHON_STARTUP_TIMEOUT_MS,
  ) {
    this.spawn = spawn;
    this.startupTimeoutMs = startupTimeoutMs;
  }

  private reset(err: Error): void {
    this.port?.terminate();
    this.port = null;
    this.starting = null;
    for (const settle of this.pending.values()) settle(err);
    this.pending.clear();
  }

  private call(
    msg: { kind: "start" } | { kind: "run"; req: PythonRequest },
    timeoutMs: number,
    onTimeout: () => Error,
  ): Promise<PythonWorkerResponse> {
    const port = this.port;
    if (!port) return Promise.reject(new Error("Python is not running."));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const err = onTimeout();
        this.reset(err);
        reject(err);
      }, timeoutMs);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        if (res instanceof Error) reject(res);
        else resolve(res);
      });
      port.post({ ...msg, id } as PythonWorkerRequest);
    });
  }

  /** Starts the worker and Python once; resolves with the startup time. */
  private start(): Promise<number> {
    if (!this.starting) {
      const port = this.spawn(
        (res) => {
          const settle = this.pending.get(res.id);
          this.pending.delete(res.id);
          settle?.(res);
        },
        // A worker that was already replaced can't take the new one down.
        (err) => {
          if (this.port === port) this.reset(err);
        },
      );
      this.port = port;
      const starting = this.call(
        { kind: "start" },
        this.startupTimeoutMs,
        () =>
          new Error(
            `Python didn't start within ${this.startupTimeoutMs / 1000} s.`,
          ),
      ).then((res) => {
        if (!res.ok) throw new Error(`Python failed to start: ${res.error}`);
        return res.startupMs ?? 0;
      });
      starting.catch((err: Error) => {
        if (this.starting === starting) this.reset(err);
      });
      this.starting = starting;
    }
    return this.starting;
  }

  run(req: PythonRequest, timeoutMs: number): Promise<PythonOutput> {
    const task = async () => {
      const fresh = !this.starting;
      const startupMs = await this.start();
      const res = await this.call(
        { kind: "run", req },
        timeoutMs,
        () => new PythonTimeoutError(),
      );
      if (!res.ok) throw new Error(res.error);
      return {
        ...(res.out ?? { stdout: "" }),
        ...(fresh ? { startupMs } : {}),
      };
    };
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    this.reset(new Error("Python was closed."));
  }
}
