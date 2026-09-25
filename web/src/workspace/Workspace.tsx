import type { Cell } from "@browser-analyst/agent";
import { useCallback, useState } from "react";
import type {
  EngineInfo,
  LoadedTable,
  PendingFile,
  Phase,
} from "../data/useDataSession";
import { formatCount, formatMs } from "../format";
import { Dropzone } from "../home/Dropzone";
import { PreviewGrid } from "./PreviewGrid";
import { ProfileTable } from "./ProfileTable";

export function Workspace({
  tables,
  phase,
  engine,
  onFiles,
  onHome,
  tableRows,
}: {
  tables: LoadedTable[];
  phase: Phase;
  engine: EngineInfo | null;
  onFiles: (files: PendingFile[]) => void;
  onHome: () => void;
  tableRows: (
    table: string,
    offset: number,
    limit: number,
  ) => Promise<Cell[][]>;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // Newest table by default, until the visitor picks one.
  const current = tables.find((t) => t.table === picked) ?? tables.at(-1);
  const fetchRows = useCallback(
    (offset: number, limit: number) =>
      current ? tableRows(current.table, offset, limit) : Promise.resolve([]),
    [current, tableRows],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onHome}
          className="text-sm font-medium uppercase tracking-wide text-slate-600 hover:underline dark:text-slate-400"
        >
          ← Browser Analyst
        </button>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {engine
            ? `DuckDB ${engine.version} in your browser · started in ${formatMs(engine.startMs)}`
            : "DuckDB runs in your browser"}
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-4">
          <nav aria-label="Tables">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Tables
            </h2>
            {tables.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                None loaded yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {tables.map((t) => (
                  <li key={t.table}>
                    <button
                      type="button"
                      onClick={() => setPicked(t.table)}
                      aria-current={
                        t.table === current?.table ? "true" : undefined
                      }
                      className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                        t.table === current?.table
                          ? "bg-indigo-50 font-semibold text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100"
                          : "hover:bg-slate-100 dark:hover:bg-slate-900"
                      }`}
                    >
                      <span className="block truncate font-mono">
                        {t.table}
                      </span>
                      <span className="block text-xs text-slate-600 dark:text-slate-400">
                        {formatCount(t.rows)} rows · {t.columns} columns
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          <Dropzone onFiles={onFiles} compact />
          <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
            <p className="font-medium">Next: ask a question</p>
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              The agent that plans, writes SQL, and answers with traceable
              numbers arrives in the next milestone.
            </p>
          </div>
        </aside>

        <main className="min-w-0 space-y-6">
          {phase.kind === "busy" && (
            <p
              role="status"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
            >
              <span
                aria-hidden="true"
                className="mr-2 inline-block animate-spin"
              >
                ◌
              </span>
              {phase.message}
            </p>
          )}
          {phase.kind === "error" && (
            <p
              role="alert"
              className="rounded-md border border-red-400 px-3 py-2 text-sm text-red-800 dark:text-red-200"
            >
              Couldn’t load that file: {phase.message}
            </p>
          )}
          {current && (
            <>
              <section aria-labelledby="table-heading">
                <h1
                  id="table-heading"
                  className="font-mono text-2xl font-semibold"
                >
                  {current.table}
                </h1>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  From {current.source} · {formatCount(current.rows)} rows ×{" "}
                  {current.columns} columns ·{" "}
                  <span
                    data-testid="timing"
                    data-load-ms={current.loadMs}
                    data-profile-ms={current.profileMs}
                  >
                    loaded in {formatMs(current.loadMs)}, profiled in{" "}
                    {formatMs(current.profileMs)}
                  </span>
                </p>
              </section>
              <section aria-labelledby="profile-heading">
                <h2 id="profile-heading" className="text-lg font-semibold">
                  Column profile
                </h2>
                <div className="mt-2">
                  <ProfileTable profile={current.profile} />
                </div>
              </section>
              <section aria-labelledby="rows-heading">
                <h2 id="rows-heading" className="text-lg font-semibold">
                  Rows
                </h2>
                <div className="mt-2">
                  <PreviewGrid
                    key={current.table}
                    table={current.table}
                    columns={current.profile.columns}
                    rowCount={current.rows}
                    fetchRows={fetchRows}
                  />
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
