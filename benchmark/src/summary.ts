// Per-task records and the run summary built from them.

import type { FailureTag } from "./score.ts";
import { CATEGORIES } from "./tasks.ts";

export interface TaskRecord {
  id: string;
  category: string;
  kind: string;
  smoke: boolean;
  pass: boolean;
  detail: string;
  tags: FailureTag[];
  outcome: "answer" | "ask_user" | "stopped";
  stop_reason?: string;
  error?: string;
  steps: number;
  tool_calls: number;
  tool_errors: number;
  /** Answers only: every key number matched its cited cell. */
  verified?: boolean;
  tokens_in: number;
  tokens_out: number;
  wall_ms: number;
  model_calls: number;
  cache_hits: number;
  refusal?: { rule: boolean; judge: boolean | null };
  answer?: string;
}

interface Tally {
  tasks: number;
  passed: number;
  /** Percent, one decimal. */
  success: number;
}

export interface Summary {
  model: string;
  provider_model: string;
  split: string;
  prompt_version: string;
  toolset_version: string;
  started_at: string;
  complete: boolean;
  overall: Tally;
  smoke: Tally;
  by_category: Record<string, Tally>;
  metrics: {
    mean_steps: number;
    /** Of tasks with a tool error, the share that still passed. */
    self_repair_rate: number | null;
    tool_error_rate: number;
    /** Of final answers, the share whose key numbers all matched their cells. */
    provenance_valid_rate: number | null;
    tokens_in: number;
    tokens_out: number;
    mean_tokens_in: number;
    wall_ms: number;
    cache_hit_rate: number;
  };
  failure_tags: Partial<Record<FailureTag, number>>;
}

const pct = (num: number, den: number) =>
  den ? Math.round((1000 * num) / den) / 10 : 0;
const ratio = (num: number, den: number) =>
  den ? Math.round((1000 * num) / den) / 1000 : null;

function tally(rs: readonly TaskRecord[]): Tally {
  const passed = rs.filter((r) => r.pass).length;
  return { tasks: rs.length, passed, success: pct(passed, rs.length) };
}

export function summarize(
  records: readonly TaskRecord[],
  meta: Pick<
    Summary,
    | "model"
    | "provider_model"
    | "split"
    | "prompt_version"
    | "toolset_version"
    | "started_at"
    | "complete"
  >,
): Summary {
  const by_category: Record<string, Tally> = {};
  for (const c of CATEGORIES) {
    const rs = records.filter((r) => r.category === c);
    if (rs.length) by_category[c] = tally(rs);
  }
  const withErrors = records.filter((r) => r.tool_errors > 0);
  const answers = records.filter((r) => r.outcome === "answer");
  const sum = (f: (r: TaskRecord) => number) =>
    records.reduce((s, r) => s + f(r), 0);
  const failure_tags: Summary["failure_tags"] = {};
  for (const r of records)
    for (const t of r.tags) failure_tags[t] = (failure_tags[t] ?? 0) + 1;
  const n = records.length || 1;
  return {
    ...meta,
    overall: tally(records),
    smoke: tally(records.filter((r) => r.smoke)),
    by_category,
    metrics: {
      mean_steps: Math.round((10 * sum((r) => r.steps)) / n) / 10,
      self_repair_rate: ratio(
        withErrors.filter((r) => r.pass).length,
        withErrors.length,
      ),
      tool_error_rate:
        ratio(
          sum((r) => r.tool_errors),
          sum((r) => r.tool_calls),
        ) ?? 0,
      provenance_valid_rate: ratio(
        answers.filter((r) => r.verified).length,
        answers.length,
      ),
      tokens_in: sum((r) => r.tokens_in),
      tokens_out: sum((r) => r.tokens_out),
      mean_tokens_in: Math.round(sum((r) => r.tokens_in) / n),
      wall_ms: Math.round(sum((r) => r.wall_ms)),
      cache_hit_rate:
        ratio(
          sum((r) => r.cache_hits),
          sum((r) => r.model_calls),
        ) ?? 0,
    },
    failure_tags,
  };
}

// ------------------------------------------------------------------ gate

const GATE_POINTS = 5;
export interface Baseline {
  model: string;
  provider_model: string;
  prompt_version: string;
  toolset_version: string;
  recorded_at: string;
  overall: Summary["overall"];
  smoke: Summary["smoke"];
  by_category: Summary["by_category"];
  metrics: Summary["metrics"];
}

/** Passes when smoke success is at most GATE_POINTS below the baseline's. */
export function gate(
  summary: Summary,
  baseline: Baseline,
): { ok: boolean; floor: number } {
  const floor = Math.round((baseline.smoke.success - GATE_POINTS) * 10) / 10;
  return { ok: summary.complete && summary.smoke.success >= floor, floor };
}
