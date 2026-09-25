import type {
  ChartRecord,
  Column,
  PythonSuccess,
  SqlSuccess,
  StoredResult,
  TableInfo,
  TableProfile,
} from "@browser-analyst/agent";
import { useState } from "react";
import type { StepView, ToolView } from "../agent/useAgent";
import { formatCount, formatMs } from "../format";
import { ChartView } from "./ChartView";
import { ResultTable } from "./ResultTable";
import { Code, SqlCode } from "./SqlCode";

const PREVIEW_ROWS = 5;

/** Charts the final answer shows, so their step cards don't draw them twice. */
export type ChartsInAnswer = ReadonlySet<string>;

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p
      className={`text-xs font-medium ${ok ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}`}
    >
      <span aria-hidden="true">{ok ? "✓ " : "✕ "}</span>
      <span className="sr-only">{ok ? "Succeeded: " : "Failed: "}</span>
      {children}
    </p>
  );
}

function TableResult({
  result,
  note = "",
}: {
  result: Pick<
    SqlSuccess,
    "result_id" | "columns" | "row_count" | "preview" | "truncated"
  > & { elapsed_ms: number };
  note?: string;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? result.preview : result.preview.slice(0, PREVIEW_ROWS);
  return (
    <div className="space-y-1">
      <Status ok>
        {result.result_id} · {formatCount(result.row_count)} row
        {result.row_count === 1 ? "" : "s"}
        {result.truncated ? " (capped)" : ""} · {formatMs(result.elapsed_ms)}
        {note}
      </Status>
      {rows.length > 0 && (
        <ResultTable
          columns={result.columns}
          rows={rows}
          caption={`Preview of result ${result.result_id}`}
        />
      )}
      {result.preview.length > PREVIEW_ROWS && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="text-xs font-medium underline underline-offset-2"
        >
          {all
            ? "Show fewer rows"
            : `Show all ${result.preview.length} preview rows`}
        </button>
      )}
    </div>
  );
}

function errorOf(output: unknown): string {
  const o = output as { error?: string; problems?: string[] } | null;
  return [o?.error, ...(o?.problems ?? [])].filter(Boolean).join(" ");
}

function Stdout({ text }: { text: string }) {
  if (!text) return null;
  return (
    <figure aria-label="Printed output">
      <pre className="max-h-48 overflow-auto rounded-md border border-slate-200 p-2 font-mono text-xs whitespace-pre-wrap dark:border-slate-800">
        {text}
      </pre>
    </figure>
  );
}

function PythonOutput({ result }: { result: PythonSuccess }) {
  const startup =
    result.startup_ms !== undefined
      ? ` · Python started in ${formatMs(result.startup_ms)}`
      : "";
  return (
    <div className="space-y-2">
      <Stdout text={result.stdout} />
      {result.result_id ? (
        <TableResult
          result={{
            result_id: result.result_id,
            columns: result.columns ?? ([] as Column[]),
            row_count: result.row_count ?? 0,
            preview: result.preview ?? [],
            truncated: result.truncated ?? false,
            elapsed_ms: result.elapsed_ms,
          }}
          note={startup}
        />
      ) : (
        <Status ok>
          Ran in {formatMs(result.elapsed_ms)} (no result table){startup}
        </Status>
      )}
    </div>
  );
}

function ToolBlock({
  tool,
  getResult,
  chartsInAnswer,
}: {
  tool: ToolView;
  getResult: (id: string) => StoredResult | undefined;
  chartsInAnswer: ChartsInAnswer;
}) {
  const input = (tool.input ?? {}) as Record<string, unknown>;
  switch (tool.ok ? tool.tool : "error") {
    case "run_sql":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Query: {String(input.purpose ?? "")}
          </p>
          <SqlCode sql={String(input.sql ?? "")} />
          <TableResult result={tool.output as SqlSuccess} />
        </div>
      );
    case "run_python":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Python: {String(input.purpose ?? "")}
          </p>
          <Code code={String(input.code ?? "")} language="python" />
          <PythonOutput result={tool.output as PythonSuccess} />
        </div>
      );
    case "make_chart": {
      const chart = tool.output as ChartRecord;
      const title = chart.spec.title || `${chart.spec.mark} chart`;
      if (chartsInAnswer.has(chart.chart_id))
        return (
          <Status ok>
            Drew chart {chart.chart_id} ({title}) from {chart.result_id}; it’s
            shown with the answer
          </Status>
        );
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">Chart: {title}</p>
          <ChartView chart={chart} getResult={getResult} />
        </div>
      );
    }
    case "describe_table": {
      const p = tool.output as TableProfile;
      return (
        <Status ok>
          Profiled {p.table}: {p.columns.length} columns, {formatCount(p.rows)}{" "}
          rows
        </Status>
      );
    }
    case "list_tables": {
      const { tables } = tool.output as { tables: TableInfo[] };
      return (
        <Status ok>
          Listed {tables.length} table{tables.length === 1 ? "" : "s"}:{" "}
          {tables.map((t) => t.table).join(", ")}
        </Status>
      );
    }
    case "final_answer":
      return <Status ok>Submitted the answer</Status>;
    case "ask_user":
      return <Status ok>Asked you a question</Status>;
    default:
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {tool.tool === "run_sql"
              ? `Query: ${String(input.purpose ?? "")}`
              : tool.tool === "run_python"
                ? `Python: ${String(input.purpose ?? "")}`
                : tool.tool === "final_answer"
                  ? "Answer check"
                  : `Tool: ${tool.tool}`}
          </p>
          {tool.tool === "run_sql" && typeof input.sql === "string" && (
            <SqlCode sql={input.sql} />
          )}
          {tool.tool === "run_python" && typeof input.code === "string" && (
            <>
              <Code code={input.code} language="python" />
              <Stdout
                text={(tool.output as { stdout?: string } | null)?.stdout ?? ""}
              />
            </>
          )}
          <Status ok={false}>
            {tool.tool === "final_answer" ? "Answer rejected: " : "Error: "}
            {errorOf(tool.output) || tool.summary}
          </Status>
        </div>
      );
  }
}

const NO_CHARTS: ChartsInAnswer = new Set();

export function StepCard({
  step,
  getResult = () => undefined,
  chartsInAnswer = NO_CHARTS,
}: {
  step: StepView;
  getResult?: (id: string) => StoredResult | undefined;
  chartsInAnswer?: ChartsInAnswer;
}) {
  return (
    <article
      aria-label={`Step ${step.id}`}
      className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-slate-600 dark:text-slate-400">
        <span className="font-semibold uppercase tracking-wide">
          Step {step.id}
        </span>
        {step.model && (
          <span>
            {step.provider ? `${step.provider} · ` : ""}
            {step.model}
            {step.durationMs !== undefined && ` · ${formatMs(step.durationMs)}`}
            {step.tokens &&
              ` · ${formatCount(step.tokens.input_tokens)} in / ${formatCount(step.tokens.output_tokens)} out tokens`}
          </span>
        )}
      </header>
      {step.text && (
        <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">
          {step.text}
        </p>
      )}
      {step.tools.map((t) => (
        <ToolBlock
          key={t.id}
          tool={t}
          getResult={getResult}
          chartsInAnswer={chartsInAnswer}
        />
      ))}
    </article>
  );
}
