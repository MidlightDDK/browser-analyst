import { describe, expect, it } from "vitest";
import {
  type AgentSandbox,
  LAST_STEP_NOTE,
  NO_TOOL_NOTE,
  runAgent,
} from "./loop.ts";
import {
  type ModelClient,
  ModelError,
  type ModelStepResponse,
} from "./model.ts";
import type { Cell, Column, StoredResult, TableProfile } from "./sandbox.ts";
import type { WireMessage } from "./wire.ts";

const PROFILE: TableProfile = {
  table: "penguins",
  rows: 3,
  columns: [
    {
      name: "species",
      type: "VARCHAR",
      null_pct: 0,
      approx_distinct: 3,
      min: "Adelie",
      max: "Gentoo",
      top_values: ["Adelie", "Gentoo", "Chinstrap"],
    },
  ],
  sample_rows: [["Adelie"]],
};

const MEAN_SQL =
  "SELECT species, avg(body_mass_g) AS mean_mass FROM penguins GROUP BY 1 ORDER BY 2 DESC";
const MEAN: { columns: Column[]; rows: Cell[][] } = {
  columns: [
    { name: "species", type: "VARCHAR" },
    { name: "mean_mass", type: "DOUBLE" },
  ],
  rows: [
    ["Gentoo", 5076.016260162602],
    ["Chinstrap", 3733.0882352941176],
    ["Adelie", 3700.662251655629],
  ],
};

/** Runs known queries; anything else fails like a DuckDB parser error. */
function fakeSandbox(
  queries: Record<string, { columns: Column[]; rows: Cell[][] }> = {
    [MEAN_SQL]: MEAN,
  },
): AgentSandbox {
  const results = new Map<string, StoredResult>();
  return {
    listTables: async () => [{ table: "penguins", rows: 3, columns: 1 }],
    describe: async (t) => {
      if (t !== "penguins") throw new Error(`Unknown table: ${t}`);
      return PROFILE;
    },
    sql: async (q) => {
      const r = queries[q];
      if (!r)
        return {
          error: `Parser Error: syntax error at or near "${q.slice(0, 10)}"`,
        };
      const id = `r${results.size + 1}`;
      results.set(id, { id, ...r, truncated: false });
      return {
        result_id: id,
        columns: r.columns,
        row_count: r.rows.length,
        preview: r.rows.slice(0, 20),
        truncated: false,
        elapsed_ms: 1,
      };
    },
    getResult: (id) => results.get(id),
  };
}

type Scripted = ModelStepResponse | ModelError;

const reply = (calls: [string, unknown][], text = ""): ModelStepResponse => ({
  text,
  toolCalls: calls.map(([name, args], i) => ({
    id: `c${i}`,
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  })),
  usage: { input_tokens: 100, output_tokens: 10 },
  provider: "fake",
  model: "fake-1",
  latencyMs: 5,
});

/** A model that plays back `script` and records every request. */
function scripted(
  script: Scripted[],
): ModelClient & { requests: WireMessage[][] } {
  const requests: WireMessage[][] = [];
  return {
    requests,
    async step({ messages }) {
      requests.push(messages);
      const next = script[requests.length - 1];
      if (!next) throw new Error("script exhausted");
      if (next instanceof ModelError) throw next;
      return next;
    },
  };
}

const runSql = (sql: string) =>
  ["run_sql", { sql, purpose: "mean mass" }] as [string, unknown];
const answer = (value: number, extra: Record<string, unknown> = {}) =>
  [
    "final_answer",
    {
      answer_markdown: `Gentoo penguins are heaviest (${value} g on average).`,
      key_numbers: [
        {
          label: "Gentoo mean body mass (g)",
          value,
          result_id: "r1",
          column: "mean_mass",
          row: 0,
        },
      ],
      ...extra,
    },
  ] as [string, unknown];

const input = {
  question: "Which species is heaviest?",
  catalog: "Table penguins: 3 rows",
};

const toolMessages = (messages: WireMessage[]) =>
  messages.filter((m) => m.role === "tool").map((m) => m.content);

describe("runAgent", () => {
  it("recovers after a SQL error and answers with verified numbers", async () => {
    const model = scripted([
      reply([runSql("SELEC oops")], "Compute the mean mass per species."),
      reply([runSql(MEAN_SQL)]),
      reply([answer(5076)]),
    ]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    expect(res.outcome).toMatchObject({ kind: "answer", verified: true });
    expect(res.steps).toBe(3);
    expect(toolMessages(model.requests[1] ?? []).join()).toContain(
      "Parser Error",
    );
    expect(res.usage).toEqual({ input_tokens: 300, output_tokens: 30 });
    expect(res.events.map((e) => `${e.stepId}:${e.type}:${e.ok}`)).toEqual([
      "1:model:true",
      "1.1:tool:false",
      "2:model:true",
      "2.1:tool:true",
      "3:model:true",
      "3.1:tool:true",
      "3:answer:true",
    ]);
  });

  it("stops at the step cap after asking for a final answer", async () => {
    const list = reply([["list_tables", {}]]);
    const model = scripted([list, list, list]);
    const res = await runAgent(
      { ...input, settings: { maxSteps: 3 } },
      { model, sandbox: fakeSandbox() },
    );
    expect(res.outcome).toMatchObject({ kind: "stopped", reason: "step_cap" });
    expect(model.requests).toHaveLength(3);
    expect(model.requests[2]?.at(-1)).toEqual({
      role: "user",
      content: LAST_STEP_NOTE,
    });
    expect(model.requests[1]?.at(-1)?.role).toBe("tool");
    expect(res.events.at(-1)?.type).toBe("stop");
  });

  it("clamps maxSteps to the hard cap", async () => {
    const list = reply([["list_tables", {}]]);
    const model = scripted(Array.from({ length: 20 }, () => list));
    const res = await runAgent(
      { ...input, settings: { maxSteps: 50 } },
      { model, sandbox: fakeSandbox() },
    );
    expect(res.steps).toBe(12);
  });

  it("stops after 3 consecutive failures of the same tool", async () => {
    const bad = reply([runSql("SELEC 1")]);
    const model = scripted([bad, bad, bad, reply([answer(5076)])]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    expect(res.outcome).toMatchObject({
      kind: "stopped",
      reason: "repeated_failure",
    });
    if (res.outcome.kind === "stopped")
      expect(res.outcome.message).toMatch(
        /run_sql failed 3 times in a row.*Parser Error/,
      );
    expect(model.requests).toHaveLength(3);
  });

  it("resets the failure streak when the tool succeeds", async () => {
    const bad = reply([runSql("SELEC 1")]);
    const model = scripted([
      bad,
      bad,
      reply([runSql(MEAN_SQL)]),
      bad,
      bad,
      reply([answer(5076)]),
    ]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    expect(res.outcome).toMatchObject({ kind: "answer", verified: true });
  });

  it("returns invalid tool arguments to the model as fixable errors", async () => {
    const model = scripted([
      reply([
        ["run_sql", { sql: MEAN_SQL }],
        ["run_sql", '{"sql": "SELECT 1",'],
        ["drop_table", {}],
        ["describe_table", { table: "birds" }],
        ["describe_table", { table: "penguins", extra: 1 }],
      ]),
      reply([runSql(MEAN_SQL)]),
      reply([answer(5076)]),
    ]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    const errors = toolMessages(model.requests[1] ?? []);
    expect(errors).toHaveLength(5);
    expect(errors[0]).toContain(
      "Invalid arguments for run_sql: arguments.purpose is required",
    );
    expect(errors[1]).toContain("not valid JSON");
    expect(errors[2]).toContain('Unknown tool \\"drop_table\\"');
    expect(errors[3]).toContain(
      'Unknown table \\"birds\\". Loaded tables: penguins',
    );
    expect(errors[4]).toContain('unknown property \\"extra\\"');
    // Tool call ids stay unique across steps even when the provider reuses them.
    const ids = (model.requests[2] ?? []).flatMap((m) =>
      m.role === "assistant" ? (m.tool_calls ?? []).map((c) => c.id) : [],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(res.outcome.kind).toBe("answer");
  });

  it("ends the turn on ask_user", async () => {
    const model = scripted([
      reply([
        [
          "ask_user",
          { question: "Mean or median?", options: ["Mean", "Median"] },
        ],
      ]),
    ]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    expect(res.outcome).toEqual({
      kind: "ask_user",
      question: "Mean or median?",
      options: ["Mean", "Median"],
    });
    expect(model.requests).toHaveLength(1);
  });

  it("rejects a planted wrong number once, then accepts the corrected answer", async () => {
    const model = scripted([
      reply([runSql(MEAN_SQL)]),
      reply([answer(5200)]),
      reply([answer(5076.02)]),
    ]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    const rejection = toolMessages(model.requests[2] ?? []).at(-1) ?? "";
    expect(rejection).toContain("not accepted");
    expect(rejection).toContain(
      "r1.mean_mass row 0, which is 5076.016260162602",
    );
    expect(res.outcome).toMatchObject({ kind: "answer", verified: true });
  });

  it("accepts a second wrong answer with a visible warning", async () => {
    const model = scripted([
      reply([runSql(MEAN_SQL)]),
      reply([answer(5200)]),
      reply([answer(6000)]),
    ]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    expect(res.outcome).toMatchObject({ kind: "answer", verified: false });
    if (res.outcome.kind === "answer")
      expect(res.outcome.checks[0]?.ok).toBe(false);
    expect(res.events.at(-1)).toMatchObject({ type: "answer", ok: false });
  });

  it("accepts an unverified answer on the last step", async () => {
    const model = scripted([reply([runSql(MEAN_SQL)]), reply([answer(5200)])]);
    const res = await runAgent(
      { ...input, settings: { maxSteps: 2 } },
      { model, sandbox: fakeSandbox() },
    );
    expect(res.outcome).toMatchObject({ kind: "answer", verified: false });
  });

  it("nudges a text-only reply and stops after three in a row", async () => {
    const text = reply([], "The answer is Gentoo.");
    const model = scripted([text, text, text]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    expect(model.requests[1]?.at(-1)).toEqual({
      role: "user",
      content: NO_TOOL_NOTE,
    });
    expect(res.outcome).toMatchObject({
      kind: "stopped",
      reason: "repeated_failure",
    });
  });

  it("collapses older steps and keeps the last 3 verbatim", async () => {
    const list = reply([["list_tables", {}]]);
    const model = scripted([
      reply([runSql(MEAN_SQL)]),
      list,
      list,
      list,
      reply([answer(5076)]),
    ]);
    await runAgent(input, { model, sandbox: fakeSandbox() });
    const last = model.requests[4] ?? [];
    const first = last[0]?.content ?? "";
    expect(first).toContain("Question: Which species is heaviest?");
    expect(first).toContain(
      "step 1: run_sql → 3 row(s) (r1) [species, mean_mass]: mean mass",
    );
    expect(last.filter((m) => m.role === "assistant")).toHaveLength(3);
    expect(last.filter((m) => m.role === "tool")).toHaveLength(3);
  });

  it("retries a transient model failure once, then stops on quota", async () => {
    const model = scripted([
      new ModelError("upstream", "provider failed"),
      reply([runSql(MEAN_SQL)]),
      new ModelError("quota", "The free AI quota is used up"),
    ]);
    const res = await runAgent(input, { model, sandbox: fakeSandbox() });
    expect(res.outcome).toMatchObject({
      kind: "stopped",
      reason: "model_error",
      errorReason: "quota",
    });
    expect(res.steps).toBe(1);
  });

  it("stops when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await runAgent(input, {
      model: scripted([]),
      sandbox: fakeSandbox(),
      signal: ctrl.signal,
    });
    expect(res.outcome).toMatchObject({ kind: "stopped", reason: "aborted" });
  });
});
