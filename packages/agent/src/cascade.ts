// Tier 0 of a cascade: PocketSQL, a 0.5B text-to-SQL model fine-tuned for
// DuckDB (https://github.com/MidlightDDK/pocketsql), answers first, locally and
// for free; the agent takes over when the local answer looks wrong. The rules
// match PocketSQL's own cascade eval (training/src/pocketsql/evalx/cascade.py):
// the SQL fails (guard, parse, or run), returns nothing (no rows, or only
// NULLs), or a second sample at temperature 0.3 returns a different result.
// Chart requests go straight to the agent: tier 0 only writes one query.
import {
  buildMessages,
  type ChatMessage,
  cleanSql,
  introspect,
  serializeSchema,
} from "@pocketsql/sqlgen";
import type { Cell, Sandbox } from "./sandbox.ts";

/** A local text-to-SQL model: greedy, or one sample at temperature 0.3. */
export interface LocalSqlModel {
  generate(messages: ChatMessage[], sample: boolean): Promise<string>;
}

export type Escalation = "chart" | "error" | "empty" | "disagree";

export interface Tier0Answer {
  sql: string;
  /** The second sample, when one was drawn. */
  sampleSql?: string;
  /** Result id of `sql` in the sandbox, when it ran. */
  resultId?: string;
  /** Why the agent answers instead; absent when the local answer stands. */
  escalate?: Escalation;
}

const CHART = /\b(?:chart|plot|graph|visuali[sz]e|histogram)\b/i;
const TOL = 1e-6;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

async function run(
  sandbox: Sandbox,
  sql: string,
): Promise<{ id: string; rows: Cell[][] } | undefined> {
  const res = await sandbox.sql(sql);
  if ("error" in res) return undefined;
  const stored = sandbox.getResult(res.result_id);
  return stored ? { id: res.result_id, rows: stored.rows } : undefined;
}

/** The loaded tables in PocketSQL's prompt format (one CREATE TABLE line each). */
export async function tier0Schema(sandbox: Sandbox): Promise<string> {
  const schema = await introspect(async (sql) => {
    const res = await run(sandbox, sql);
    if (!res) throw new Error(`introspection failed: ${sql}`);
    return res.rows;
  });
  return serializeSchema(schema);
}

/** Whether the outermost query has ORDER BY (not a subquery or window). */
export function hasOrderBy(sql: string): boolean {
  let s = sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "''");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, "()");
  }
  return /\border\s+by\b/i.test(s);
}

/** Numbers (and numeric text) compare as floats, like PocketSQL's scorer. */
function norm(v: Cell): Cell {
  if (typeof v === "boolean") return Number(v);
  if (typeof v === "string" && NUMBER.test(v.trim())) return Number(v);
  return v;
}

const key = (row: Cell[]) =>
  JSON.stringify(
    row.map((v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)),
  );

function same(a: Cell, b: Cell): boolean {
  if (typeof a === "number" && typeof b === "number")
    return (
      a === b ||
      Math.abs(a - b) <= Math.max(TOL, TOL * Math.max(Math.abs(a), Math.abs(b)))
    );
  return a === b;
}

function sorted(rows: Cell[][]): Cell[][] {
  return rows
    .map((r) => ({ k: key(r), r }))
    .sort((p, q) => (p.k < q.k ? -1 : p.k > q.k ? 1 : 0))
    .map((e) => e.r);
}

/** Same rows (in order only when both queries sort), 1e-6 float tolerance. */
export function sameResult(
  a: Cell[][],
  b: Cell[][],
  ordered: boolean,
): boolean {
  if (a.length !== b.length) return false;
  let [x, y] = [a.map((r) => r.map(norm)), b.map((r) => r.map(norm))];
  if (!ordered) [x, y] = [sorted(x), sorted(y)];
  return x.every((r, i) => {
    const s = y[i] as Cell[];
    return r.length === s.length && r.every((v, j) => same(v, s[j] as Cell));
  });
}

/**
 * Asks the local model. `agree: false` skips the second sample (the cheaper
 * rule: keep any answer that runs and returns rows).
 */
export async function tier0(
  question: string,
  schema: string,
  model: LocalSqlModel,
  sandbox: Sandbox,
  { agree = true }: { agree?: boolean } = {},
): Promise<Tier0Answer> {
  if (CHART.test(question)) return { sql: "", escalate: "chart" };
  const messages = buildMessages(schema, question);
  const sql = cleanSql(await model.generate(messages, false));
  const first = await run(sandbox, sql);
  if (!first) return { sql, escalate: "error" };
  if (first.rows.every((r) => r.every((v) => v === null)))
    return { sql, resultId: first.id, escalate: "empty" };
  if (!agree) return { sql, resultId: first.id };
  const sampleSql = cleanSql(await model.generate(messages, true));
  const second = await run(sandbox, sampleSql);
  const ordered = hasOrderBy(sql) && hasOrderBy(sampleSql);
  const ok =
    second !== undefined && sameResult(first.rows, second.rows, ordered);
  return {
    sql,
    sampleSql,
    resultId: first.id,
    ...(ok ? {} : { escalate: "disagree" as const }),
  };
}
