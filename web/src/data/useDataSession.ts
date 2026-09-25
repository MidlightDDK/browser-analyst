// One DuckDB-WASM sandbox per tab, created on the first file or sample so
// first paint never waits for the engine.

import type {
  Cell,
  RegisteredTable,
  TableProfile,
} from "@browser-analyst/agent";
import { useCallback, useRef, useState } from "react";
import type { BrowserDuckDBSandbox } from "../sandbox/duckdb";

export interface LoadedTable extends RegisteredTable {
  profile: TableProfile;
  /** File read + DuckDB load, in ms. */
  loadMs: number;
  profileMs: number;
}

export interface PendingFile {
  name: string;
  read: () => Promise<Uint8Array>;
}

export type Phase =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "error"; message: string };

export interface EngineInfo {
  version: string;
  startMs: number;
}

export function useDataSession() {
  const sandbox = useRef<Promise<BrowserDuckDBSandbox> | null>(null);
  const [tables, setTables] = useState<LoadedTable[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  // The resolved sandbox, for synchronous result lookups (key-number links).
  const [ready, setReady] = useState<BrowserDuckDBSandbox | null>(null);

  const getSandbox = useCallback(() => {
    if (!sandbox.current) {
      const start = performance.now();
      const created = import("../sandbox/duckdb")
        .then((m) => m.BrowserDuckDBSandbox.create())
        .then((sb) => {
          setEngine({
            version: sb.version,
            startMs: Math.round(performance.now() - start),
          });
          setReady(sb);
          return sb;
        });
      created.catch(() => {
        sandbox.current = null;
      });
      sandbox.current = created;
    }
    return sandbox.current;
  }, []);

  const addFiles = useCallback(
    async (files: PendingFile[]) => {
      try {
        if (!sandbox.current)
          setPhase({
            kind: "busy",
            message: "Starting DuckDB in your browser…",
          });
        const sb = await getSandbox();
        for (const file of files) {
          setPhase({ kind: "busy", message: `Loading ${file.name}…` });
          const start = performance.now();
          const registered = await sb.registerFile(
            file.name,
            await file.read(),
          );
          const loadMs = Math.round(performance.now() - start);
          for (const t of registered) {
            setPhase({ kind: "busy", message: `Profiling ${t.table}…` });
            const profileStart = performance.now();
            const profile = await sb.describe(t.table);
            const profileMs = Math.round(performance.now() - profileStart);
            setTables((prev) => [
              ...prev,
              { ...t, loadMs, profile, profileMs },
            ]);
          }
        }
        setPhase({ kind: "idle" });
      } catch (err) {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [getSandbox],
  );

  const tableRows = useCallback(
    async (table: string, offset: number, limit: number): Promise<Cell[][]> =>
      (await getSandbox()).tableRows(table, offset, limit),
    [getSandbox],
  );

  return {
    tables,
    phase,
    engine,
    addFiles,
    tableRows,
    getSandbox,
    sandbox: ready,
  };
}
