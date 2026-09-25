import type {
  SqlSuccess,
  TableInfo,
  TableProfile,
} from "@browser-analyst/agent";
import { useState } from "react";
import type { StepView, ToolView } from "../agent/useAgent";
import { formatCount, formatMs } from "../format";
import { ResultTable } from "./ResultTable";
import { SqlCode } from "./SqlCode";

const PREVIEW_ROWS = 5;

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

function SqlResult({ result }: { result: SqlSuccess }) {
  const [all, setAll] = useState(false);
  const rows = all ? result.preview : result.preview.slice(0, PREVIEW_ROWS);
  return (
    <div className="space-y-1">
      <Status ok>
        {result.result_id} · {formatCount(result.row_count)} row
        {result.row_count === 1 ? "" : "s"}
        {result.truncated ? " (capped)" : ""} · {formatMs(result.elapsed_ms)}
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

function ToolBlock({ tool }: { tool: ToolView }) {
  const input = (tool.input ?? {}) as Record<string, unknown>;
  switch (tool.ok ? tool.tool : "error") {
    case "run_sql":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Query: {String(input.purpose ?? "")}
          </p>
          <SqlCode sql={String(input.sql ?? "")} />
          <SqlResult result={tool.output as SqlSuccess} />
        </div>
      );
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
              : tool.tool === "final_answer"
                ? "Answer check"
                : `Tool: ${tool.tool}`}
          </p>
          {tool.tool === "run_sql" && typeof input.sql === "string" && (
            <SqlCode sql={input.sql} />
          )}
          <Status ok={false}>
            {tool.tool === "final_answer" ? "Answer rejected: " : "Error: "}
            {errorOf(tool.output) || tool.summary}
          </Status>
        </div>
      );
  }
}

export function StepCard({ step }: { step: StepView }) {
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
        <ToolBlock key={t.id} tool={t} />
      ))}
    </article>
  );
}
