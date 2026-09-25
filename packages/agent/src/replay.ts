// A recorded run (`pnpm replay:record`): the loop's trace events with their
// original timing, the outcome, and the stored results the answer, charts,
// and result tables point at, so the UI can play it back with no model and no
// sandbox.

import type { Outcome, TraceEvent } from "./loop.ts";
import type { StoredResult } from "./sandbox.ts";
import type { Usage } from "./wire.ts";

export const REPLAY_VERSION = 1;
/** Rows kept per stored result; enough for the charts the samples draw. */
export const REPLAY_RESULT_ROWS = 2_000;

export interface Replay {
  version: typeof REPLAY_VERSION;
  /** `${sample id}-${question number}`, e.g. "penguins-1". */
  id: string;
  sample: string;
  question: string;
  provider: string;
  model: string;
  recorded_at: string;
  prompt_version: string;
  toolset_version: string;
  events: TraceEvent[];
  outcome: Outcome;
  usage: Usage;
  durationMs: number;
  results: StoredResult[];
}

/** Ids of every result a successful tool call stored, in order. */
export function replayResultIds(events: readonly TraceEvent[]): string[] {
  const ids: string[] = [];
  for (const e of events) {
    const id = (e.output as { result_id?: unknown } | null | undefined)
      ?.result_id;
    if (
      e.type === "tool" &&
      e.ok &&
      typeof id === "string" &&
      !ids.includes(id)
    )
      ids.push(id);
  }
  return ids;
}

/** Cuts a stored result to REPLAY_RESULT_ROWS rows. */
export function capResult(r: StoredResult): StoredResult {
  return r.rows.length > REPLAY_RESULT_ROWS
    ? { ...r, rows: r.rows.slice(0, REPLAY_RESULT_ROWS), truncated: true }
    : r;
}
