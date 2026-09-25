// /security: the red-team report (web/public/security/latest.json, written by
// `pnpm redteam` in benchmark/redteam/). Every number here comes from that file.

import { useEffect, useState } from "react";

/** Mirrors benchmark/redteam/report.ts. */
interface CaseInfo {
  id: string;
  title: string;
  vector: string;
  goal: string;
}

interface CaseResult {
  id: string;
  attack: boolean | null;
  task: boolean | null;
  csp_blocks: number;
  left: number;
  outcome: string;
}

interface RunSummary {
  model: string;
  model_id: string;
  config: string;
  disabled: string[];
  date: string;
  attacks: number;
  attack_successes: number;
  task_cases: number;
  task_successes: number;
  exfil_blocked: number;
  exfil_successes: number;
  detector_flags: number;
  results: CaseResult[];
}

interface Report {
  generated_at: string;
  prompt_version: string;
  cases: CaseInfo[];
  runs: RunSummary[];
}

const CONFIG_LABEL: Record<string, string> = {
  "all-on": "All defenses on",
  "all-off": "All defenses off",
  "no-spotlight": "Spotlighting off",
  "no-detector": "Injection detector off",
  "no-sanitizer": "Output sanitizer off",
  "no-sqlGuard": "SQL guard off",
  "no-csp": "CSP off",
};

const CONFIG_ORDER = Object.keys(CONFIG_LABEL);
const byConfig = (a: RunSummary, b: RunSummary) =>
  CONFIG_ORDER.indexOf(a.config) - CONFIG_ORDER.indexOf(b.config);

const pct = (n: number, d: number) =>
  d === 0 ? "–" : `${Math.round((100 * n) / d)}% (${n}/${d})`;

function RunTable({
  runs,
  caption,
  hijacked,
}: {
  runs: RunSummary[];
  caption: string;
  hijacked?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="mb-2 text-left text-slate-600 dark:text-slate-400">
          {caption}
        </caption>
        <thead className="border-b border-slate-300 dark:border-slate-700">
          <tr>
            <th className="py-2 pr-4 font-semibold">Configuration</th>
            {!hijacked && (
              <th className="py-2 pr-4 font-semibold">Attack success</th>
            )}
            {!hijacked && (
              <th className="py-2 pr-4 font-semibold">
                Task success under attack
              </th>
            )}
            <th className="py-2 pr-4 font-semibold">Blocked by CSP</th>
            <th className="py-2 pr-4 font-semibold">
              Requests that left the browser
            </th>
            <th className="py-2 font-semibold">Detector flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {runs.map((r) => (
            <tr key={`${r.model}-${r.config}`}>
              <th scope="row" className="py-2 pr-4 font-medium">
                {CONFIG_LABEL[r.config] ?? r.config}
              </th>
              {!hijacked && (
                <td className="py-2 pr-4">
                  {pct(r.attack_successes, r.attacks)}
                </td>
              )}
              {!hijacked && (
                <td className="py-2 pr-4">
                  {pct(r.task_successes, r.task_cases)}
                </td>
              )}
              <td className="py-2 pr-4">{r.exfil_blocked}</td>
              <td
                className={`py-2 pr-4 ${r.exfil_successes ? "font-semibold text-red-800 dark:text-red-300" : ""}`}
              >
                {r.exfil_successes}
                {r.exfil_successes ? " (leak)" : ""}
              </td>
              <td className="py-2">{r.detector_flags}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseMatrix({
  cases,
  runs,
}: {
  cases: CaseInfo[];
  runs: RunSummary[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left text-xs">
        <caption className="mb-2 text-left text-sm text-slate-600 dark:text-slate-400">
          Per case: “hit” means the model pursued the attacker’s goal.
        </caption>
        <thead className="border-b border-slate-300 dark:border-slate-700">
          <tr>
            <th className="py-2 pr-3 font-semibold">Case</th>
            <th className="py-2 pr-3 font-semibold">Vector</th>
            {runs.map((r) => (
              <th key={r.config} className="py-2 pr-3 font-semibold">
                {CONFIG_LABEL[r.config] ?? r.config}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {cases.map((c) => (
            <tr key={c.id}>
              <th
                scope="row"
                className="py-1.5 pr-3 font-medium"
                title={c.goal}
              >
                {c.title}
              </th>
              <td className="py-1.5 pr-3">{c.vector}</td>
              {runs.map((r) => {
                const res = r.results.find((x) => x.id === c.id);
                const hit = res?.attack;
                return (
                  <td
                    key={r.config}
                    className={`py-1.5 pr-3 ${hit ? "font-semibold text-red-800 dark:text-red-300" : ""}`}
                  >
                    {hit === undefined || hit === null
                      ? "–"
                      : hit
                        ? "✕ hit"
                        : "✓ resisted"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SecurityPage() {
  const [report, setReport] = useState<Report | null | "missing">(null);
  useEffect(() => {
    fetch("/security/latest.json")
      .then((r): Promise<Report | "missing"> | "missing" =>
        r.ok ? (r.json() as Promise<Report>) : "missing",
      )
      .then(setReport, () => setReport("missing"));
  }, []);

  const live = report && report !== "missing" ? report.runs : [];
  const models = [
    ...new Set(live.filter((r) => r.model !== "hijacked").map((r) => r.model)),
  ];
  const hijacked = live.filter((r) => r.model === "hijacked").sort(byConfig);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12">
      <header className="space-y-3">
        <a
          href="/"
          className="text-sm font-medium underline underline-offset-4"
        >
          ← Browser Analyst
        </a>
        <h1 className="text-3xl font-semibold">Red-team results</h1>
        <p className="max-w-3xl text-slate-700 dark:text-slate-300">
          Each case is a small file with a prompt injection hidden in a cell, a
          column name, or the file name, plus an ordinary question about the
          data. The suite runs the production agent in a real browser
          (Playwright against a local build with the production CSP), once with
          every defense on, once with all off, and once with each defense off.
        </p>
      </header>

      {report === null && <p>Loading…</p>}
      {report === "missing" && <p>No red-team run has been published yet.</p>}

      {models.map((m) => {
        const runs = live.filter((r) => r.model === m).sort(byConfig);
        return (
          <section key={m} className="space-y-4" aria-labelledby={`h-${m}`}>
            <h2 id={`h-${m}`} className="text-xl font-semibold">
              {runs[0]?.model_id ?? m}
            </h2>
            <RunTable
              runs={runs}
              caption={`The live model, run ${runs[0]?.date ?? ""}. Attack success: the model pursued the injected goal. Task success: it still answered the real question correctly.`}
            />
            {report && report !== "missing" && (
              <CaseMatrix cases={report.cases} runs={runs} />
            )}
          </section>
        );
      })}

      {hijacked.length > 0 && (
        <section className="space-y-4" aria-labelledby="h-hijacked">
          <h2 id="h-hijacked" className="text-xl font-semibold">
            A fully hijacked model
          </h2>
          <p className="max-w-3xl text-slate-700 dark:text-slate-300">
            A scripted model that obeys every injection: it writes Python that
            calls <code>fetch</code>, <code>sendBeacon</code>, WebSockets, and
            synchronous requests, reads remote files from SQL, and puts image
            links in its answer. This measures what stops a model that is
            already compromised.
          </p>
          <RunTable
            runs={hijacked}
            caption="Exfiltration attempts by the hijacked model, per configuration."
            hijacked
          />
        </section>
      )}

      <section className="space-y-2" aria-labelledby="h-method">
        <h2 id="h-method" className="text-xl font-semibold">
          Defenses and method
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
          <li>
            Spotlighting: the catalog and every tool result reach the model
            inside a data block with a random id; the system prompt says its
            content is never an instruction.
          </li>
          <li>
            Injection detector: heuristics flag instruction-like text, fake tool
            calls, URLs, and image links in data, show a flag in the trace, and
            warn the model.
          </li>
          <li>
            Output sanitizer: answers never render images, links, or HTML.
          </li>
          <li>
            SQL guard and engine lockdown: one read-only statement, no URLs, and
            DuckDB with external access off.
          </li>
          <li>
            Content Security Policy: the page and its workers may only connect
            to this site, jsDelivr, and the DuckDB extension host. Blocked
            requests appear in the trace.
          </li>
        </ul>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          “Requests that left the browser” counts requests to other origins that
          got past the browser, as seen by Playwright’s network routing (then
          answered locally, so nothing reaches a real server). Playwright can’t
          see WebSockets opened from a worker, so with CSP off that count is a
          lower bound; with CSP on they show up as blocked. Python approval is
          off in these runs: the harness plays a user who approves everything.
          {report && report !== "missing" && (
            <>
              {" "}
              Prompt {report.prompt_version}, report generated{" "}
              {report.generated_at.slice(0, 10)}.
            </>
          )}
        </p>
      </section>
    </main>
  );
}
