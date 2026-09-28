import type { ChatMessage } from "@pocketsql/sqlgen";
import { describe, expect, it } from "vitest";
import {
  hasOrderBy,
  type LocalSqlModel,
  sameResult,
  tier0,
  tier0Schema,
} from "./cascade.ts";
import type { Cell, Sandbox, SqlResult, StoredResult } from "./sandbox.ts";

/** Answers known queries with fixed rows; anything else is an error. */
function fakeSandbox(
  answers: Record<string, Cell[][]> | ((query: string) => Cell[][]),
): Sandbox {
  const results = new Map<string, StoredResult>();
  return {
    async sql(query: string): Promise<SqlResult> {
      const q = query.trim().replace(/;+\s*$/, ""); // as the SQL guard does
      const rows = typeof answers === "function" ? answers(q) : answers[q];
      if (!rows) return { error: "Binder Error: no such column" };
      const id = `r${results.size + 1}`;
      results.set(id, { id, columns: [], rows, truncated: false });
      return {
        result_id: id,
        columns: [],
        row_count: rows.length,
        preview: rows,
        truncated: false,
        elapsed_ms: 1,
      };
    },
    getResult: (id: string) => results.get(id),
  } as unknown as Sandbox;
}

/** Returns the greedy answer, then the sample; records the prompts. */
function fakeModel(greedy: string, sample = greedy) {
  const calls: { messages: ChatMessage[]; sample: boolean }[] = [];
  const model: LocalSqlModel = {
    async generate(messages, s) {
      calls.push({ messages, sample: s });
      return s ? sample : greedy;
    },
  };
  return { model, calls };
}

const Q = "How many penguins are there?";
const SCHEMA = "CREATE TABLE penguins (species VARCHAR);";

describe("tier0", () => {
  it("keeps an answer that runs, returns rows, and a sample agrees", async () => {
    const sandbox = fakeSandbox({
      "SELECT count(*) FROM penguins": [[344]],
      "SELECT count(species) + 2 FROM penguins": [["344"]],
    });
    const { model, calls } = fakeModel(
      "```sql\nSELECT count(*) FROM penguins;\n```",
      "SELECT count(species) + 2 FROM penguins",
    );
    const answer = await tier0(Q, SCHEMA, model, sandbox);
    expect(answer).toMatchObject({
      sql: "SELECT count(*) FROM penguins;",
      resultId: "r1",
    });
    expect(answer.escalate).toBeUndefined();
    expect(calls.map((c) => c.sample)).toEqual([false, true]);
    expect(calls[0]?.messages[1]?.content).toBe(`${SCHEMA}\n\nQuestion: ${Q}`);
  });

  it("escalates errors, empty results, and disagreement", async () => {
    const sandbox = fakeSandbox({
      "SELECT 1 WHERE false": [],
      "SELECT NULL": [[null]],
      "SELECT 1": [[1]],
      "SELECT 2": [[2]],
    });
    const why = async (greedy: string, sample?: string) =>
      (await tier0(Q, SCHEMA, fakeModel(greedy, sample).model, sandbox))
        .escalate;
    expect(await why("SELECT nope")).toBe("error");
    expect(await why("")).toBe("error");
    expect(await why("SELECT 1 WHERE false")).toBe("empty");
    expect(await why("SELECT NULL")).toBe("empty");
    expect(await why("SELECT 1", "SELECT 2")).toBe("disagree");
    expect(await why("SELECT 1", "SELECT broken")).toBe("disagree");
    expect(await why("SELECT 1", "SELECT 1")).toBeUndefined();
  });

  it("sends charts to the agent and can skip the second sample", async () => {
    const sandbox = fakeSandbox({ "SELECT 1": [[1]] });
    const chart = fakeModel("SELECT 1");
    expect(
      (await tier0("Plot body mass by species", SCHEMA, chart.model, sandbox))
        .escalate,
    ).toBe("chart");
    expect(chart.calls).toHaveLength(0);
    const once = fakeModel("SELECT 1");
    const answer = await tier0(Q, SCHEMA, once.model, sandbox, {
      agree: false,
    });
    expect(answer.escalate).toBeUndefined();
    expect(once.calls).toHaveLength(1);
  });
});

describe("sameResult", () => {
  it("ignores row order unless both queries sort", () => {
    const a: Cell[][] = [
      ["a", 1],
      ["b", 2],
    ];
    const b: Cell[][] = [
      ["b", 2.0000000001],
      ["a", "1"],
    ];
    expect(sameResult(a, b, false)).toBe(true);
    expect(sameResult(a, b, true)).toBe(false);
    expect(sameResult(a, [["a", 1]], false)).toBe(false);
    expect(sameResult([[true]], [[1]], true)).toBe(true);
    expect(sameResult([[1.5]], [[1.6]], true)).toBe(false);
  });
});

describe("hasOrderBy", () => {
  it.each([
    ["SELECT a FROM t ORDER BY a", true],
    ["SELECT a FROM t order\n by a DESC LIMIT 3", true],
    ["SELECT a FROM (SELECT a FROM t ORDER BY a)", false],
    ["SELECT rank() OVER (ORDER BY a) FROM t", false],
    ["SELECT 'order by' FROM t", false],
    ['SELECT "order by" FROM t', false],
  ])("%s → %s", (sql, want) => {
    expect(hasOrderBy(sql)).toBe(want);
  });
});

describe("tier0Schema", () => {
  it("serializes the loaded tables the way PocketSQL was trained", async () => {
    const sandbox = fakeSandbox((q) =>
      q.includes("information_schema.tables")
        ? [["penguins"]]
        : q.includes("information_schema.columns")
          ? [
              ["species", "VARCHAR"],
              ["body_mass_g", "DOUBLE"],
            ]
          : q.includes("count(DISTINCT")
            ? [[3]]
            : [["Adelie"], ["Gentoo"], ["Chinstrap"]],
    );
    expect(await tier0Schema(sandbox)).toBe(
      "CREATE TABLE penguins (species VARCHAR /* e.g. 'Adelie', 'Gentoo' */, body_mass_g DOUBLE);",
    );
  });
});
