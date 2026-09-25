// Benchmark tasks (benchmark/tasks.jsonl): one JSON object per line.

import { readFile, writeFile } from "node:fs/promises";
import type { Cell } from "@browser-analyst/agent";
import { BENCH_DIR } from "./datasets.ts";

export const CATEGORIES = [
  "aggregation",
  "filter",
  "join",
  "time_series",
  "cleaning",
  "statistics",
  "chart",
  "multi_step",
  "ambiguous",
  "impossible",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface TableValue {
  columns: string[];
  rows: Cell[][];
}

export interface Expected {
  kind: "number" | "table" | "set" | "chart" | "clarify" | "refuse";
  /** The ground truth (reviewed by a person); `value` is computed from it. */
  reference_sql?: string;
  /** A number, or a table for table, set, and chart. */
  value?: number | TableValue;
  /** Relative tolerance for numbers (default 1e-6). */
  tolerance?: number;
  order_matters?: boolean;
  /** Reference columns an answer must reproduce (default: all). */
  columns?: string[];
  chart_checks?: { marks: string[] };
}

export interface Task {
  id: string;
  category: Category;
  datasets: string[];
  question: string;
  /** In the fixed 15-task smoke split. */
  smoke?: boolean;
  expected: Expected;
}

const TASKS_PATH = `${BENCH_DIR}tasks.jsonl`;

export async function loadTasks(): Promise<Task[]> {
  const text = await readFile(TASKS_PATH, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Task);
}

export async function saveTasks(tasks: readonly Task[]): Promise<void> {
  await writeFile(
    TASKS_PATH,
    `${tasks.map((t) => JSON.stringify(t)).join("\n")}\n`,
  );
}

export function selectTasks(tasks: readonly Task[], split: string): Task[] {
  if (split === "all") return [...tasks];
  if (split === "smoke") return tasks.filter((t) => t.smoke);
  const ids = new Set(split.split(","));
  const picked = tasks.filter((t) => ids.has(t.id) || ids.has(t.category));
  if (!picked.length) throw new Error(`no tasks match ${split}`);
  return picked;
}
