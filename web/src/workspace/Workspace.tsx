import type { Cell, StoredResult } from "@browser-analyst/agent";
import { useCallback, useState } from "react";
import type { Agent } from "../agent/useAgent";
import { ChatPanel } from "../chat/ChatPanel";
import type {
  EngineInfo,
  LoadedTable,
  PendingFile,
  Phase,
} from "../data/useDataSession";
import { formatCount, formatMs } from "../format";
import { Dropzone } from "../home/Dropzone";
import { PayloadDrawer } from "../trace/PayloadDrawer";
import { TracePanel } from "../trace/TracePanel";
import { PreviewGrid } from "./PreviewGrid";
import { ProfileTable } from "./ProfileTable";

type Tab = "data" | "chat" | "trace";
const TABS: [Tab, string][] = [
  ["data", "Data"],
  ["chat", "Chat"],
  ["trace", "Trace"],
];

function DataPanel({
  tables,
  phase,
  onFiles,
  tableRows,
}: {
  tables: LoadedTable[];
  phase: Phase;
  onFiles: (files: PendingFile[]) => void;
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
    <div className="space-y-6">
      <nav aria-label="Tables">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Tables
        </h2>
        {tables.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            None loaded yet.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {tables.map((t) => (
              <li key={t.table}>
                <button
                  type="button"
                  onClick={() => setPicked(t.table)}
                  aria-current={t.table === current?.table ? "true" : undefined}
                  className={`rounded-md border px-3 py-2 text-left text-sm ${
                    t.table === current?.table
                      ? "border-indigo-300 bg-indigo-50 font-semibold text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100"
                      : "border-slate-200 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-900"
                  }`}
                >
                  <span className="block truncate font-mono">{t.table}</span>
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
      {phase.kind === "busy" && (
        <p
          role="status"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
        >
          <span aria-hidden="true" className="mr-2 inline-block animate-spin">
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
            <h1 id="table-heading" className="font-mono text-2xl font-semibold">
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
    </div>
  );
}

export function Workspace({
  tables,
  phase,
  engine,
  onFiles,
  onHome,
  tableRows,
  agent,
  suggestions,
  draft,
  getResult,
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
  agent: Agent;
  suggestions: string[];
  draft: string;
  getResult: (id: string) => StoredResult | undefined;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const [payloadOpen, setPayloadOpen] = useState(false);
  const shown = (t: Tab) => (tab === t ? "block" : "hidden lg:block");

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-6">
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

      <div
        role="tablist"
        aria-label="Workspace panels"
        className="mt-4 flex gap-1 border-b border-slate-200 lg:hidden dark:border-slate-800"
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === id
                ? "border-indigo-600 text-indigo-900 dark:text-indigo-100"
                : "border-transparent text-slate-600 dark:text-slate-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_minmax(0,3fr)]">
        <div className={`min-w-0 ${shown("data")}`}>
          <DataPanel
            tables={tables}
            phase={phase}
            onFiles={onFiles}
            tableRows={tableRows}
          />
        </div>
        <div className={`min-w-0 ${shown("chat")}`}>
          <ChatPanel
            agent={agent}
            ready={tables.length > 0}
            suggestions={suggestions}
            draft={draft}
            getResult={getResult}
            onShowPayload={() => setPayloadOpen(true)}
          />
        </div>
        <div
          className={`min-w-0 lg:col-span-2 xl:col-span-1 ${shown("trace")}`}
        >
          <TracePanel turns={agent.turns} />
        </div>
      </div>
      <PayloadDrawer
        payload={agent.lastPayload}
        open={payloadOpen}
        onClose={() => setPayloadOpen(false)}
      />
    </div>
  );
}
