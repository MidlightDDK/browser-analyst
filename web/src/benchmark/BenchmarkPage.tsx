// /benchmark: the leaderboard (web/public/benchmark/latest.json, written by
// `pnpm bench:report` in benchmark/src/). Every number here comes from that file.

import { useEffect, useState } from "react";
import { formatCount } from "../format";

/** Mirrors benchmark/src/summary.ts and report.ts. */
interface Tally {
  tasks: number;
  passed: number;
  success: number;
}

interface ModelRun {
  model: string;
  provider_model: string;
  prompt_version: string;
  toolset_version: string;
  started_at: string;
  overall: Tally;
  by_category: Record<string, Tally>;
  metrics: {
    mean_steps: number;
    self_repair_rate: number | null;
    tool_error_rate: number;
    provenance_valid_rate: number | null;
    mean_tokens_in: number;
    tokens_out: number;
  };
  failure_tags: Record<string, number>;
  failures: { id: string; category: string; tags: string[]; detail: string }[];
}

interface Report {
  generated_at: string;
  models: ModelRun[];
  judge: {
    model: string;
    cases: number;
    judge_accuracy: number;
    rule_accuracy: number;
  } | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  aggregation: "Aggregation",
  filter: "Filter",
  join: "Join",
  time_series: "Time series",
  cleaning: "Cleaning messy data",
  statistics: "Statistics",
  chart: "Chart",
  multi_step: "Multi-step",
  ambiguous: "Ambiguous (should ask)",
  impossible: "Impossible (should decline)",
};

const TAG_LABEL: Record<string, string> = {
  wrong_column: "Wrong column",
  wrong_aggregation: "Wrong value or aggregation",
  dialect_error: "SQL error it never fixed",
  gave_up: "Gave up or declined",
  asked_needlessly: "Asked when it should have answered",
  hallucinated_number: "Number not backed by its result",
  followed_injection: "Followed an injection",
  timeout: "Timed out",
  model_error: "Provider error",
};

const pct = (v: number | null) =>
  v === null ? "–" : `${Math.round(v * 1000) / 10}%`;

const th = "py-2 pr-4 font-semibold";
const td = "py-2 pr-4";

function Leaderboard({ models }: { models: ModelRun[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <caption className="mb-2 text-left text-slate-600 dark:text-slate-400">
          Ranked by success on all tasks. Steps and tokens are per task.
        </caption>
        <thead className="border-b border-slate-300 dark:border-slate-700">
          <tr>
            <th className={th}>#</th>
            <th className={th}>Model</th>
            <th className={th}>Success</th>
            <th className={th}>Steps</th>
            <th className={th}>Input tokens</th>
            <th className={th}>Self-repair</th>
            <th className={th}>Tool errors</th>
            <th className="py-2 font-semibold">Answers traced to results</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {models.map((m, i) => (
            <tr key={m.model}>
              <td className={td}>{i + 1}</td>
              <th scope="row" className={`${td} font-medium`}>
                <code>{m.provider_model}</code>
              </th>
              <td className={`${td} font-semibold`}>
                {m.overall.success}%{" "}
                <span className="font-normal text-slate-600 dark:text-slate-400">
                  ({m.overall.passed}/{m.overall.tasks})
                </span>
              </td>
              <td className={td}>{m.metrics.mean_steps}</td>
              <td className={td}>{formatCount(m.metrics.mean_tokens_in)}</td>
              <td className={td}>{pct(m.metrics.self_repair_rate)}</td>
              <td className={td}>{pct(m.metrics.tool_error_rate)}</td>
              <td className="py-2">{pct(m.metrics.provenance_valid_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ByCategory({ models }: { models: ModelRun[] }) {
  const cats = Object.keys(CATEGORY_LABEL).filter((c) =>
    models.some((m) => m.by_category[c]),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="mb-2 text-left text-slate-600 dark:text-slate-400">
          Tasks passed per category. ★ marks the best score in each row.
        </caption>
        <thead className="border-b border-slate-300 dark:border-slate-700">
          <tr>
            <th className={th}>Category</th>
            {models.map((m) => (
              <th key={m.model} className={th}>
                <code className="text-xs">{m.provider_model}</code>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {cats.map((c) => {
            const best = Math.max(
              ...models.map((m) => m.by_category[c]?.success ?? 0),
            );
            return (
              <tr key={c}>
                <th scope="row" className={`${td} font-medium`}>
                  {CATEGORY_LABEL[c] ?? c}
                </th>
                {models.map((m) => {
                  const t = m.by_category[c];
                  const top = t && t.success === best && models.length > 1;
                  return (
                    <td
                      key={m.model}
                      className={`${td} ${top ? "font-semibold" : ""}`}
                    >
                      {t ? `${t.passed}/${t.tasks} (${t.success}%)` : "–"}
                      {top && (
                        <span>
                          {" "}
                          <span aria-hidden="true">★</span>
                          <span className="sr-only">(best)</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Failures({ models }: { models: ModelRun[] }) {
  const tags = Object.keys(TAG_LABEL).filter((t) =>
    models.some((m) => m.failure_tags[t]),
  );
  return (
    <div className="space-y-4">
      {tags.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="mb-2 text-left text-slate-600 dark:text-slate-400">
              Why tasks failed (a failure can carry more than one tag).
            </caption>
            <thead className="border-b border-slate-300 dark:border-slate-700">
              <tr>
                <th className={th}>Failure</th>
                {models.map((m) => (
                  <th key={m.model} className={th}>
                    <code className="text-xs">{m.provider_model}</code>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {tags.map((t) => (
                <tr key={t}>
                  <th scope="row" className={`${td} font-medium`}>
                    {TAG_LABEL[t]}
                  </th>
                  {models.map((m) => (
                    <td key={m.model} className={td}>
                      {m.failure_tags[t] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No failures.</p>
      )}
      {models.map(
        (m) =>
          m.failures.length > 0 && (
            <details key={m.model} className="text-sm">
              <summary className="cursor-pointer font-medium">
                Failed tasks for <code>{m.provider_model}</code> (
                {m.failures.length})
              </summary>
              <ul className="mt-2 space-y-1 pl-5 text-slate-700 dark:text-slate-300">
                {m.failures.map((f) => (
                  <li key={f.id} className="list-disc">
                    <code>{f.id}</code> (
                    {CATEGORY_LABEL[f.category] ?? f.category}
                    ): {f.detail}
                    {f.tags.length > 0 &&
                      ` [${f.tags.map((t) => TAG_LABEL[t] ?? t).join(", ")}]`}
                  </li>
                ))}
              </ul>
            </details>
          ),
      )}
    </div>
  );
}

export function BenchmarkPage() {
  const [report, setReport] = useState<Report | null | "missing">(null);
  useEffect(() => {
    fetch("/benchmark/latest.json")
      .then((r): Promise<Report | "missing"> | "missing" =>
        r.ok ? (r.json() as Promise<Report>) : "missing",
      )
      .then(
        (r) => setReport(r === "missing" || !r.models?.length ? "missing" : r),
        () => setReport("missing"),
      );
  }, []);
  const ok = report && report !== "missing" ? report : null;
  const first = ok?.models[0];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12">
      <header className="space-y-3">
        <a
          href="/"
          className="text-sm font-medium underline underline-offset-4"
        >
          ← Browser Analyst
        </a>
        <h1 className="text-3xl font-semibold">Benchmark</h1>
        <p className="max-w-3xl text-slate-700 dark:text-slate-300">
          100 questions over seven openly licensed datasets, each with a
          reviewed reference SQL query as ground truth. Every model runs the
          same production agent code the site uses, with Node twins of the
          browser’s DuckDB and Python sandboxes, at temperature 0.
        </p>
      </header>

      {report === null && <p>Loading…</p>}
      {report === "missing" && <p>No benchmark run has been published yet.</p>}

      {ok && (
        <>
          <section className="space-y-3" aria-labelledby="h-board">
            <h2 id="h-board" className="text-xl font-semibold">
              Leaderboard
            </h2>
            <Leaderboard models={ok.models} />
          </section>
          <section className="space-y-3" aria-labelledby="h-cat">
            <h2 id="h-cat" className="text-xl font-semibold">
              By category
            </h2>
            <ByCategory models={ok.models} />
          </section>
          <section className="space-y-3" aria-labelledby="h-fail">
            <h2 id="h-fail" className="text-xl font-semibold">
              Failures
            </h2>
            <Failures models={ok.models} />
          </section>
        </>
      )}

      <section className="space-y-2" aria-labelledby="h-method">
        <h2 id="h-method" className="text-xl font-semibold">
          Method
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            Numbers must match the reference within a relative tolerance. Tables
            and sets are compared as multisets, ignoring column names and,
            unless the question asks for an order, row order.
          </li>
          <li>
            Charts pass rule checks on the Vega-Lite spec: the mark, encodings
            that reference result columns, and the aggregation.
          </li>
          <li>
            Ambiguous questions pass when the agent asks the user to clarify.
            Impossible ones pass when it declines, judged by an LLM with a
            keyword rule as fallback
            {ok?.judge &&
              ` (on ${ok.judge.cases} hand-labeled answers, judge accuracy ${pct(ok.judge.judge_accuracy)}, rule ${pct(ok.judge.rule_accuracy)})`}
            .
          </li>
          <li>
            Self-repair: of the tasks where a tool call failed, the share that
            still passed. Answers traced to results: final answers whose every
            key number matched the result cell it cites.
          </li>
          <li>
            Only free tiers: each model runs once, on its provider’s free quota.
            Model calls are cached, so a rerun of the harness reproduces these
            numbers without calling the model.
          </li>
        </ul>
        {first && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Prompt {first.prompt_version}, tools {first.toolset_version}.
            Leaderboard generated {ok?.generated_at.slice(0, 10)}. Run it
            yourself with <code>pnpm bench --model &lt;id&gt; --tasks all</code>
            .
          </p>
        )}
      </section>
    </main>
  );
}
