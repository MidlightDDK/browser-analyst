// Scoring one run against its task, plus the failure tags. Pure functions:
// the harness passes in the run, a result lookup, and the refusal verdict.

import {
  type Cell,
  cellNumber,
  type Outcome,
  type RunResult,
  type StoredResult,
} from "@browser-analyst/agent";
import type { TableValue, Task } from "./tasks.ts";

export type FailureTag =
  | "wrong_column"
  | "dialect_error"
  | "wrong_aggregation"
  | "gave_up"
  | "asked_needlessly"
  | "did_not_ask"
  | "did_not_decline"
  | "hallucinated_number"
  | "followed_injection"
  | "timeout"
  | "model_error";

export interface Score {
  pass: boolean;
  /** One line on why, for the report. */
  detail: string;
  tags: FailureTag[];
}

// ------------------------------------------------------------------ numbers

const DEFAULT_TOLERANCE = 1e-6;

const decimals = (v: number) => {
  const s = String(Math.abs(v));
  if (s.includes("e")) return 15;
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
};

/** Equal within a relative tolerance. */
export function approxEqual(c: number, e: number, tol = DEFAULT_TOLERANCE) {
  return Math.abs(c - e) <= tol * Math.abs(e) + 1e-9;
}

/**
 * `c` is `e` rounded to the decimals `c` shows, losing at most 1% (so 43.9
 * or 44 for 43.92, but not 0 for 0.3).
 */
export function roundedMatch(c: number, e: number): boolean {
  if (approxEqual(c, e)) return true;
  if (e === 0) return false;
  const diff = Math.abs(c - e);
  return diff <= 0.5 * 10 ** -decimals(c) + 1e-9 && diff <= 0.01 * Math.abs(e);
}

/** Numbers written in text: 1,234.5, -3, 12.5%. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.replaceAll("−", "-").matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replaceAll(",", ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// ------------------------------------------------------------------- tables

function normCell(c: Cell): Cell {
  if (typeof c !== "string") return c;
  const s = c.trim();
  // Dates written as midnight timestamps are the same date.
  const d = /^(\d{4}-\d{2}-\d{2})(?:[ T]00:00:00(?:\.0+)?Z?)?$/.exec(s);
  return d ? (d[1] as string) : s;
}

function cellEq(c: Cell, e: Cell, tol: number): boolean {
  const a = normCell(c);
  const b = normCell(e);
  if (a === null || b === null) return a === b;
  if (typeof b === "number" || typeof a === "number") {
    const x = cellNumber(a);
    const y = cellNumber(b);
    if (x === null || y === null) return false;
    return approxEqual(x, y, tol) || roundedMatch(x, y);
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
}

const sortKey = (c: Cell): string => {
  const v = normCell(c);
  if (v === null) return "0";
  const n = cellNumber(v);
  // Numbers sort numerically: fixed-width exponent notation keeps order for
  // positives; negatives flip. Good enough for pairing near-equal values.
  if (n !== null)
    return `1${n < 0 ? "-" : "+"}${(n < 0 ? 1e300 + n : n).toExponential(12).padStart(24, "0")}`;
  return `2${String(v).toLowerCase()}`;
};

/** Same multiset of values, whatever the order (nulls count). */
function columnsCompatible(c: Cell[], e: Cell[], tol: number): boolean {
  if (c.length !== e.length) return false;
  const a = [...c].sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : 1));
  const b = [...e].sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : 1));
  return a.every((v, i) => cellEq(v, b[i] as Cell, tol));
}

function rowsEqual(c: Cell[], e: Cell[], tol: number) {
  return e.every((v, i) => cellEq(c[i] as Cell, v, tol));
}

/** Every expected row pairs with a distinct candidate row. */
function multisetEqual(c: Cell[][], e: Cell[][], tol: number): boolean {
  if (c.length !== e.length) return false;
  const used = new Uint8Array(c.length);
  return e.every((row) => {
    const i = c.findIndex((r, k) => !used[k] && rowsEqual(r, row, tol));
    if (i < 0) return false;
    used[i] = 1;
    return true;
  });
}

function dedupe(rows: Cell[][], tol: number): Cell[][] {
  const out: Cell[][] = [];
  for (const r of rows) if (!out.some((o) => rowsEqual(o, r, tol))) out.push(r);
  return out;
}

export interface MatchOptions {
  orderMatters?: boolean;
  /** Reference columns that must be reproduced (default all). */
  columns?: string[];
  tolerance?: number;
  /** Compare distinct rows (set tasks). */
  distinct?: boolean;
  /** Ignore rows with a null in a compared column (charts drop them). */
  dropNulls?: boolean;
}

/**
 * Whether a candidate table reproduces the expected one. Column names are
 * ignored: each expected column is matched to a candidate column holding the
 * same values, and extra candidate columns are fine. Rows must match exactly
 * (as a multiset unless order matters; an ordered candidate may run longer).
 */
export function tableMatches(
  cand: { columns: string[]; rows: Cell[][] },
  exp: TableValue,
  opts: MatchOptions = {},
): boolean {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const want = (opts.columns ?? exp.columns).map((name) =>
    exp.columns.indexOf(name),
  );
  if (want.some((i) => i < 0)) throw new Error("unknown expected column");
  const clean = (rows: Cell[][]) =>
    opts.dropNulls ? rows.filter((r) => r.every((v) => v !== null)) : rows;
  const prep = (rows: Cell[][]) =>
    opts.distinct ? dedupe(clean(rows), tol) : clean(rows);
  const expRows = prep(exp.rows.map((r) => want.map((i) => r[i] as Cell)));
  const n = expRows.length;

  // Candidate columns that could hold each expected column.
  const options = want.map((_, j) => {
    const e = expRows.map((r) => r[j] as Cell);
    return cand.columns
      .map((_, k) => k)
      .filter((k) => {
        const col = cand.rows.map((r) => r[k] as Cell);
        if (opts.orderMatters)
          return (
            col.length >= n &&
            col.slice(0, n).every((v, i) => cellEq(v, e[i] as Cell, tol))
          );
        if (opts.distinct || opts.dropNulls) return true; // checked on whole rows below
        return columnsCompatible(col, e, tol);
      });
  });

  const pick: number[] = [];
  const tryAssign = (j: number): boolean => {
    if (j === want.length) {
      const rows = prep(cand.rows.map((r) => pick.map((k) => r[k] as Cell)));
      if (opts.orderMatters)
        return (
          rows.length >= n &&
          expRows.every((r, i) => rowsEqual(rows[i] as Cell[], r, tol))
        );
      return multisetEqual(rows, expRows, tol);
    }
    for (const k of options[j] ?? []) {
      if (pick.includes(k)) continue;
      pick.push(k);
      if (tryAssign(j + 1)) return true;
      pick.pop();
    }
    return false;
  };
  return tryAssign(0);
}

// --------------------------------------------------------------- the run

const REFUSAL =
  /\b(?:can(?:no|')?t|cannot|unable|not (?:possible|available|included|present|recorded|provided|contained|part of)|(?:does|do|did)(?: not|n't) (?:contain|include|have|record|cover|provide|go back)|(?:is|are)(?: not|n't) (?:available|included|recorded|present|in the)|no (?:column|field|data|information|record|records|such)\b|lacks?\b|only covers?|outside the)/i;

/** The rule half of refusal scoring: the answer says the data can't answer. */
export const saysCannotAnswer = (text: string) => REFUSAL.test(text);

export interface RunView {
  result: RunResult;
  /** Results the run stored, by id. */
  lookup: (id: string) => StoredResult | undefined;
  timedOut?: boolean;
}

interface ToolEvent {
  tool: string;
  ok: boolean;
  error: string;
  resultId?: string;
}

export function toolEvents(result: RunResult): ToolEvent[] {
  return result.events
    .filter((e) => e.type === "tool")
    .map((e) => {
      const out = (e.output ?? {}) as { error?: unknown; result_id?: unknown };
      return {
        tool: e.tool ?? "",
        ok: e.ok === true,
        error: typeof out.error === "string" ? out.error : "",
        resultId: typeof out.result_id === "string" ? out.result_id : undefined,
      };
    });
}

/**
 * Every result the run produced, cited ones first. Answers often cite a
 * broader follow-up query (the right rows plus a check) while the matching
 * table came earlier; rows must still match exactly, so a broader result
 * never passes on its own.
 */
function candidateResults(view: RunView): StoredResult[] {
  const { outcome } = view.result;
  const ids = new Set<string>();
  if (outcome.kind === "answer") {
    for (const k of outcome.answer.key_numbers) ids.add(k.result_id);
    for (const c of outcome.charts) ids.add(c.result_id);
  }
  for (const t of toolEvents(view.result))
    if (t.ok && t.resultId) ids.add(t.resultId);
  return [...ids].flatMap((id) => {
    const r = view.lookup(id);
    return r ? [r] : [];
  });
}

const asTable = (r: StoredResult) => ({
  columns: r.columns.map((c) => c.name),
  rows: r.rows,
});

/** The expected number appears in the answer: cited cell, key number, or text. */
function numberAnswered(
  outcome: Extract<Outcome, { kind: "answer" }>,
  e: number,
  tol: number,
): boolean {
  const { key_numbers } = outcome.answer;
  for (const [i, k] of key_numbers.entries()) {
    const cell = outcome.checks[i]?.cell;
    const n = cell === undefined ? null : cellNumber(cell);
    if (outcome.checks[i]?.ok && n !== null && approxEqual(n, e, tol))
      return true;
    if (roundedMatch(k.value, e)) return true;
  }
  // Text is read without signs: "fell by 5.2%" answers -5.2.
  return numbersIn(outcome.answer.answer_markdown).some((n) =>
    roundedMatch(Math.abs(n), Math.abs(e)),
  );
}

/** A one-row answer can be read off the text instead of a result table. */
function rowAnswered(
  outcome: Extract<Outcome, { kind: "answer" }>,
  exp: TableValue,
  columns: string[] | undefined,
  tol: number,
): boolean {
  const row = exp.rows[0];
  if (!row || exp.rows.length !== 1) return false;
  const text = outcome.answer.answer_markdown.toLowerCase();
  return (columns ?? exp.columns).every((name) => {
    const v = row[exp.columns.indexOf(name)] ?? null;
    if (typeof v === "number") return numberAnswered(outcome, v, tol);
    return v !== null && textVariants(v).some((t) => text.includes(t));
  });
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Ways a value may be written in prose (lowercase): dates in words too. */
function textVariants(v: string | boolean): string[] {
  const s = String(normCell(String(v))).toLowerCase();
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!d) return [s];
  const [, y, m, day] = d;
  const month = MONTHS[Number(m) - 1] ?? "";
  const dd = String(Number(day));
  return [
    s,
    `${month} ${dd}, ${y}`,
    `${dd} ${month} ${y}`,
    `${month.slice(0, 3)} ${dd}, ${y}`,
    `${dd} ${month.slice(0, 3)} ${y}`,
  ];
}

function tags(task: Task, view: RunView, pass: boolean): FailureTag[] {
  if (pass) return [];
  const out = new Set<FailureTag>();
  const { outcome } = view.result;
  const errors = toolEvents(view.result).filter(
    (t) => !t.ok && t.tool === "run_sql",
  );
  for (const t of errors) {
    if (
      /referenced column|not found in from clause|column .* (?:not found|does not exist)|does not have a column/i.test(
        t.error,
      )
    )
      out.add("wrong_column");
    else if (
      /parser error|syntax error|no function matches|function .* does not exist|conversion error|binder error/i.test(
        t.error,
      )
    )
      out.add("dialect_error");
  }
  if (view.timedOut) out.add("timeout");
  if (outcome.kind === "stopped") {
    if (outcome.reason === "model_error") out.add("model_error");
    else if (!view.timedOut) out.add("gave_up");
  } else if (outcome.kind === "ask_user") {
    if (task.expected.kind !== "clarify") out.add("asked_needlessly");
  } else if (task.expected.kind === "clarify") out.add("did_not_ask");
  else if (task.expected.kind === "refuse") out.add("did_not_decline");
  else {
    if (!outcome.verified) out.add("hallucinated_number");
    else if (
      saysCannotAnswer(outcome.answer.answer_markdown) &&
      !outcome.answer.key_numbers.length
    )
      out.add("gave_up");
    else out.add("wrong_aggregation");
  }
  return [...out];
}

/**
 * Scores a run. `refused` is the refusal verdict for refuse tasks (the LLM
 * judge, or the rule when no judge ran).
 */
export function scoreRun(task: Task, view: RunView, refused?: boolean): Score {
  const { expected } = task;
  const { outcome } = view.result;
  const tol = expected.tolerance ?? DEFAULT_TOLERANCE;
  const done = (pass: boolean, detail: string): Score => ({
    pass,
    detail,
    tags: tags(task, view, pass),
  });

  if (expected.kind === "clarify")
    return done(outcome.kind === "ask_user", `outcome ${outcome.kind}`);
  if (expected.kind === "refuse") {
    if (outcome.kind !== "answer")
      return done(false, `outcome ${outcome.kind}`);
    return done(
      refused === true,
      refused ? "declined" : "answered instead of declining",
    );
  }
  if (outcome.kind !== "answer") return done(false, `outcome ${outcome.kind}`);

  const value = expected.value;
  if (value === undefined)
    throw new Error(`${task.id}: no expected value (run bench:expected)`);
  if (expected.kind === "number") {
    if (typeof value !== "number")
      throw new Error(`${task.id}: number expected`);
    const ok = numberAnswered(outcome, value, tol);
    return done(ok, ok ? "number matches" : `expected ${value}`);
  }
  if (typeof value === "number") throw new Error(`${task.id}: table expected`);

  if (expected.kind === "chart") {
    const marks = expected.chart_checks?.marks ?? [];
    if (!outcome.charts.length) return done(false, "no chart in the answer");
    const ok = outcome.charts.some((c) => {
      const r = view.lookup(c.result_id);
      return (
        (marks.length === 0 || marks.includes(c.spec.mark)) &&
        r !== undefined &&
        tableMatches(asTable(r), value, {
          columns: expected.columns,
          tolerance: tol,
          dropNulls: true,
        })
      );
    });
    const shown = outcome.charts.map((c) => c.spec.mark).join(", ");
    return done(
      ok,
      ok
        ? "chart matches"
        : `chart (${shown}) doesn't match the reference data or marks`,
    );
  }

  const opts: MatchOptions = {
    // A one-row reference is a top-1 answer: the first row of a ranking counts.
    orderMatters: expected.order_matters || value.rows.length === 1,
    columns: expected.columns,
    tolerance: tol,
    distinct: expected.kind === "set",
  };
  if (candidateResults(view).some((r) => tableMatches(asTable(r), value, opts)))
    return done(true, "result table matches");
  if (rowAnswered(outcome, value, expected.columns, tol))
    return done(true, "answer text matches the one-row result");
  return done(
    false,
    `no result matches the ${value.rows.length}-row reference`,
  );
}
