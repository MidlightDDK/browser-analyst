// final_answer validation: every key number must match the result cell it
// cites, allowing for the rounding a person would do when writing it down.

import type { Cell, StoredResult } from "./sandbox.ts";

export interface KeyNumber {
  label: string;
  value: number;
  result_id: string;
  column: string;
  row?: number;
}

export interface FinalAnswer {
  answer_markdown: string;
  key_numbers: KeyNumber[];
  chart_ids?: string[];
  caveats?: string[];
}

export interface KeyNumberCheck {
  ok: boolean;
  /** The cited cell, when it exists. */
  cell?: Cell;
  /** Resolved column name and row, when they exist. */
  column?: string;
  row?: number;
  /** Why it failed, phrased for the model. */
  problem?: string;
}

const decimals = (v: number) => {
  const s = String(Math.abs(v));
  if (s.includes("e")) return -1;
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
};

/** Significant digits of an integer written with trailing zeros (1230000 → 3). */
const intSigFigs = (v: number) =>
  String(Math.abs(v)).replace(/^0+/, "").replace(/0+$/, "").length;

function roundSig(x: number, sig: number): number {
  if (x === 0) return 0;
  const p = sig - Math.ceil(Math.log10(Math.abs(x)));
  const f = 10 ** p;
  return Math.round(x * f) / f;
}

/**
 * True when `value` is `target` as a person might write it: rounded to the
 * decimals shown, or (for integers ending in zeros) to at least 2 significant
 * digits.
 */
function closeTo(value: number, target: number): boolean {
  if (value === target) return true;
  const d = decimals(value);
  if (d === -1) return Math.abs(value - target) <= 1e-9 * Math.abs(target);
  const tol = 0.5 * 10 ** -d + 1e-9 * Math.abs(target);
  if (Math.abs(value - target) <= tol) return true;
  if (d === 0 && value !== 0) {
    const sig = intSigFigs(value);
    return sig >= 2 && roundSig(target, sig) === value;
  }
  return false;
}

export function cellNumber(cell: Cell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell === "string" && cell.trim() !== "") {
    const n = Number(cell);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Matches the cell itself, or a fraction cell stated as a percentage. */
export function matchesCell(value: number, cell: Cell): boolean {
  const n = cellNumber(cell);
  if (n === null) return false;
  return closeTo(value, n) || closeTo(value, n * 100);
}

const fmt = (c: Cell) =>
  typeof c === "string" ? JSON.stringify(c) : String(c);

export function checkKeyNumbers(
  answer: FinalAnswer,
  getResult: (id: string) => StoredResult | undefined,
): KeyNumberCheck[] {
  return answer.key_numbers.map((k, i) => {
    const where = `key_numbers[${i}] ("${k.label}" = ${k.value})`;
    const result = getResult(k.result_id);
    if (!result)
      return {
        ok: false,
        problem: `${where} cites ${k.result_id}, which doesn't exist. Cite a result_id from run_sql or run_python, such as r1.`,
      };
    let col = result.columns.findIndex((c) => c.name === k.column);
    if (col === -1)
      col = result.columns.findIndex(
        (c) => c.name.toLowerCase() === k.column.toLowerCase(),
      );
    if (col === -1)
      return {
        ok: false,
        problem: `${where} cites column "${k.column}", but ${k.result_id} has columns ${result.columns.map((c) => `"${c.name}"`).join(", ")}.`,
      };
    const column = result.columns[col]?.name ?? k.column;
    const row = k.row ?? 0;
    if (row >= result.rows.length)
      return {
        ok: false,
        column,
        problem: `${where} cites row ${row}, but ${k.result_id} has ${result.rows.length} row(s) (rows are 0-based).`,
      };
    const cell = result.rows[row]?.[col] ?? null;
    if (matchesCell(k.value, cell)) return { ok: true, cell, column, row };
    return {
      ok: false,
      cell,
      column,
      row,
      problem: `${where} doesn't match ${k.result_id}.${column} row ${row}, which is ${fmt(cell)}.`,
    };
  });
}
