// Red-team report: the latest result of each (model, configuration) merged
// into web/public/security/latest.json, which the /security page shows.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PROMPT_VERSION, TOOLSET_VERSION } from "@browser-analyst/agent";
import { CASES } from "./cases.ts";

export interface CaseResult {
  id: string;
  /** The model pursued the attacker's goal (null for the control case). */
  attack: boolean | null;
  /** It still answered the real question (null for the hijacked model). */
  task: boolean | null;
  /** CSP violations shown in the trace. */
  csp_blocks: number;
  /** Requests to non-allowed origins that got past the browser. */
  left: number;
  left_urls: string[];
  detector_flags: number;
  outcome: "answer" | "ask_user" | "stopped" | "timeout";
  steps: number;
  ms: number;
}

export interface RunSummary {
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

export interface Report {
  generated_at: string;
  prompt_version: string;
  toolset_version: string;
  cases: { id: string; title: string; vector: string; goal: string }[];
  runs: RunSummary[];
}

export const REPORT_PATH = new URL(
  "../../web/public/security/latest.json",
  import.meta.url,
);

const count = (rs: CaseResult[], f: (r: CaseResult) => boolean) =>
  rs.filter(f).length;
const sum = (rs: CaseResult[], f: (r: CaseResult) => number) =>
  rs.reduce((n, r) => n + f(r), 0);

export function summarizeRun(
  meta: Pick<RunSummary, "model" | "model_id" | "config" | "disabled">,
  results: CaseResult[],
): RunSummary {
  return {
    ...meta,
    date: new Date().toISOString().slice(0, 10),
    attacks: count(results, (r) => r.attack !== null),
    attack_successes: count(results, (r) => r.attack === true),
    task_cases: count(results, (r) => r.task !== null),
    task_successes: count(results, (r) => r.task === true),
    exfil_blocked: sum(results, (r) => r.csp_blocks),
    exfil_successes: sum(results, (r) => r.left),
    detector_flags: sum(results, (r) => r.detector_flags),
    results,
  };
}

/** Replaces the runs with the same model and configuration; keeps the rest. */
export async function mergeIntoReport(runs: RunSummary[]): Promise<Report> {
  const old: Report | null = existsSync(REPORT_PATH)
    ? (JSON.parse(await readFile(REPORT_PATH, "utf8")) as Report)
    : null;
  const key = (r: RunSummary) => `${r.model}/${r.config}`;
  const fresh = new Set(runs.map(key));
  const report: Report = {
    generated_at: new Date().toISOString(),
    prompt_version: PROMPT_VERSION,
    toolset_version: TOOLSET_VERSION,
    cases: CASES.filter((c) => c.attack.length > 0).map(
      ({ id, title, vector, goal }) => ({ id, title, vector, goal }),
    ),
    runs: [
      // Runs from another prompt version aren't comparable; drop them.
      ...(old?.prompt_version === PROMPT_VERSION ? old.runs : []).filter(
        (r) => !fresh.has(key(r)),
      ),
      ...runs,
    ],
  };
  await mkdir(new URL(".", REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 1)}\n`);
  return report;
}
