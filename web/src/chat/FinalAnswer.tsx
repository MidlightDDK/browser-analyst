import type {
  FinalAnswer as Answer,
  ChartRecord,
  KeyNumberCheck,
  StoredResult,
} from "@browser-analyst/agent";
import { useState } from "react";
import { formatCell } from "../format";
import { ChartView } from "./ChartView";
import { Markdown } from "./Markdown";
import { ResultTable } from "./ResultTable";
import { Code } from "./SqlCode";

/** The code that produced a result, for the evidence view. */
export interface ResultSource {
  language: "sql" | "python";
  code: string;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 10 });

function Evidence({
  resultId,
  row,
  column,
  getResult,
  sourceFor,
}: {
  resultId: string;
  row: number;
  column: string;
  getResult: (id: string) => StoredResult | undefined;
  sourceFor: (id: string) => ResultSource | undefined;
}) {
  const result = getResult(resultId);
  const source = sourceFor(resultId);
  if (!result)
    return <p className="text-sm">Result {resultId} isn’t available.</p>;
  const first = Math.max(0, row - 2);
  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-800">
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Result {resultId} ({result.rows.length} row
        {result.rows.length === 1 ? "" : "s"})
        {source
          ? `, from this ${source.language === "sql" ? "query" : "Python code"}:`
          : ""}
      </p>
      {source && <Code code={source.code} language={source.language} />}
      <ResultTable
        columns={result.columns}
        rows={result.rows.slice(first, first + 5)}
        firstRow={first}
        caption={`Result ${resultId}, rows ${first} to ${first + 4}`}
        highlight={{ row, column }}
      />
    </div>
  );
}

export function FinalAnswer({
  answer,
  checks,
  verified,
  charts = [],
  getResult,
  sourceFor,
}: {
  answer: Answer;
  checks: KeyNumberCheck[];
  verified: boolean;
  charts?: ChartRecord[];
  getResult: (id: string) => StoredResult | undefined;
  sourceFor: (id: string) => ResultSource | undefined;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const failed = checks.filter((c) => !c.ok).length;
  return (
    <section
      aria-label="Answer"
      className="space-y-3 rounded-lg border-2 border-indigo-200 p-4 dark:border-indigo-900"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-300">
        Answer
      </h3>
      {!verified && (
        <p
          role="alert"
          className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <span aria-hidden="true">⚠ </span>
          {failed > 0
            ? `${failed} key number${failed === 1 ? "" : "s"} didn’t match the result cell cited, even after a retry. Treat ${failed === 1 ? "it" : "them"} with care.`
            : "The answer cited a chart that was never drawn, even after a retry, so it’s left out."}
        </p>
      )}
      <Markdown text={answer.answer_markdown} />
      {charts.map((c) => (
        <ChartView key={c.chart_id} chart={c} getResult={getResult} />
      ))}
      {answer.key_numbers.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Key numbers, each traced to its result
          </h4>
          <ul className="mt-1 space-y-1">
            {answer.key_numbers.map((k, i) => {
              const check = checks[i];
              const row = check?.row ?? k.row ?? 0;
              const column = check?.column ?? k.column;
              return (
                <li
                  key={`${k.result_id}.${k.column}.${row}.${k.label}`}
                  className="text-sm"
                >
                  <button
                    type="button"
                    aria-expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                    className="text-left underline decoration-dotted underline-offset-4 hover:decoration-solid"
                  >
                    {k.label}: <strong>{fmt(k.value)}</strong>
                  </button>{" "}
                  <span
                    className={`text-xs ${check?.ok ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}`}
                  >
                    {check?.ok ? "✓ matches" : "✕ doesn’t match"} {k.result_id}.
                    {column} row {row}
                    {!check?.ok && check?.cell !== undefined
                      ? ` (cell is ${formatCell(check.cell)})`
                      : ""}
                  </span>
                  {open === i && (
                    <Evidence
                      resultId={k.result_id}
                      row={row}
                      column={column}
                      getResult={getResult}
                      sourceFor={sourceFor}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {answer.caveats && answer.caveats.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Caveats
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {answer.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
