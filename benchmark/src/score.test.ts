import type {
  Cell,
  ChartRecord,
  KeyNumberCheck,
  Outcome,
  RunResult,
  StoredResult,
  TraceEvent,
} from "@browser-analyst/agent";
import { describe, expect, it } from "vitest";
import { cacheKey } from "./models.ts";
import {
  numbersIn,
  type RunView,
  roundedMatch,
  saysCannotAnswer,
  scoreRun,
  tableMatches,
} from "./score.ts";
import type { Expected, Task } from "./tasks.ts";

const table = (columns: string[], rows: Cell[][]) => ({ columns, rows });

function stored(id: string, columns: string[], rows: Cell[][]): StoredResult {
  return {
    id,
    columns: columns.map((name) => ({ name, type: "" })),
    rows,
    truncated: false,
  };
}

const sqlEvent = (resultId: string): TraceEvent => ({
  stepId: "1.1",
  type: "tool",
  tool: "run_sql",
  input: {},
  output: { result_id: resultId },
  outputPreview: "",
  ok: true,
  durationMs: 1,
  at: 0,
});

const errorEvent = (error: string): TraceEvent => ({
  ...sqlEvent(""),
  output: { error },
  ok: false,
});

function answer(
  markdown: string,
  keys: { value: number; result_id: string; cell?: Cell; ok?: boolean }[] = [],
  opts: { verified?: boolean; charts?: ChartRecord[] } = {},
): Outcome {
  return {
    kind: "answer",
    answer: {
      answer_markdown: markdown,
      key_numbers: keys.map((k) => ({
        label: "x",
        value: k.value,
        result_id: k.result_id,
        column: "c",
      })),
    },
    checks: keys.map(
      (k): KeyNumberCheck => ({ ok: k.ok ?? true, cell: k.cell }),
    ),
    verified: opts.verified ?? true,
    charts: opts.charts ?? [],
  };
}

function view(
  outcome: Outcome,
  results: StoredResult[] = [],
  events: TraceEvent[] = [],
): RunView {
  const result: RunResult = {
    outcome,
    steps: 2,
    usage: { input_tokens: 0, output_tokens: 0 },
    events: [...results.map((r) => sqlEvent(r.id)), ...events],
  };
  return { result, lookup: (id) => results.find((r) => r.id === id) };
}

const task = (expected: Expected): Task => ({
  id: "t",
  category: "aggregation",
  datasets: [],
  question: "q",
  expected,
});

describe("numbers", () => {
  it("accepts rounding that keeps the value within 1%", () => {
    expect(roundedMatch(43.9, 43.92)).toBe(true);
    expect(roundedMatch(44, 43.92)).toBe(true);
    expect(roundedMatch(5076, 5076.016)).toBe(true);
    expect(roundedMatch(0, 0.3)).toBe(false);
    expect(roundedMatch(5000, 5076)).toBe(false);
    expect(roundedMatch(43.8, 43.92)).toBe(false);
  });

  it("reads numbers from prose", () => {
    expect(numbersIn("1,234.5 kg, −3 and 12.5%")).toEqual([1234.5, -3, 12.5]);
  });
});

describe("tableMatches", () => {
  const exp = table(
    ["species", "n"],
    [
      ["Adelie", 152],
      ["Gentoo", 124],
      ["Chinstrap", 68],
    ],
  );

  it("ignores column names, column order, row order, and extra columns", () => {
    const cand = table(
      ["count", "extra", "name"],
      [
        [68, 1, "Chinstrap"],
        [152, 2, "Adelie"],
        [124, 3, "gentoo"],
      ],
    );
    expect(tableMatches(cand, exp)).toBe(true);
  });

  it("fails on a missing or extra row", () => {
    expect(
      tableMatches(
        table(
          ["s", "n"],
          [
            ["Adelie", 152],
            ["Gentoo", 124],
          ],
        ),
        exp,
      ),
    ).toBe(false);
    expect(
      tableMatches(table(["s", "n"], [...exp.rows, ["Emperor", 1]]), exp),
    ).toBe(false);
  });

  it("accepts values rounded in SQL", () => {
    const e = table(
      ["hr", "avg"],
      [
        [0, 53.898],
        [1, 33.3757],
      ],
    );
    expect(
      tableMatches(
        table(
          ["h", "a"],
          [
            [1, 33.38],
            [0, 53.9],
          ],
        ),
        e,
      ),
    ).toBe(true);
    expect(
      tableMatches(
        table(
          ["h", "a"],
          [
            [1, 33],
            [0, 50],
          ],
        ),
        e,
      ),
    ).toBe(false);
  });

  it("checks order when it matters, allowing a longer ranking", () => {
    const e = table(
      ["c", "v"],
      [
        ["Monaco", 3],
        ["Liechtenstein", 2],
      ],
    );
    const longer = table(
      ["c", "v"],
      [
        ["Monaco", 3],
        ["Liechtenstein", 2],
        ["Luxembourg", 1],
      ],
    );
    expect(tableMatches(longer, e, { orderMatters: true })).toBe(true);
    expect(
      tableMatches(
        table(
          ["c", "v"],
          [
            ["Liechtenstein", 2],
            ["Monaco", 3],
          ],
        ),
        e,
        { orderMatters: true },
      ),
    ).toBe(false);
  });

  it("treats midnight timestamps as dates and compares only the named columns", () => {
    const e = table(
      ["day", "label", "revenue"],
      [
        ["2010-12-01", "Wed", 10],
        ["2010-12-02", "Thu", 20],
      ],
    );
    const cand = table(
      ["d", "r"],
      [
        ["2010-12-02 00:00:00", 20],
        ["2010-12-01 00:00:00", 10],
      ],
    );
    expect(tableMatches(cand, e, { columns: ["day", "revenue"] })).toBe(true);
    expect(tableMatches(cand, e)).toBe(false);
  });

  it("compares sets without duplicates and can drop null rows", () => {
    const e = table(["island"], [["Biscoe"]]);
    expect(
      tableMatches(
        table(
          ["i", "n"],
          [
            ["Biscoe", 1],
            ["Biscoe", 2],
          ],
        ),
        e,
        { distinct: true },
      ),
    ).toBe(true);
    const pts = table(
      ["x", "y"],
      [
        [1, 2],
        [null, 3],
      ],
    );
    expect(
      tableMatches(table(["y", "x"], [[2, 1]]), pts, { dropNulls: true }),
    ).toBe(true);
  });
});

describe("scoreRun", () => {
  it("passes a number cited from its exact cell or rounded in the text", () => {
    const t = task({ kind: "number", value: 5076.016 });
    expect(
      scoreRun(
        t,
        view(
          answer("About 5,076 g.", [
            { value: 5076, result_id: "r1", cell: 5076.016 },
          ]),
        ),
      ).pass,
    ).toBe(true);
    expect(scoreRun(t, view(answer("About 5,076.02 g."))).pass).toBe(true);
    const wrong = scoreRun(
      t,
      view(
        answer("About 4,000 g.", [
          { value: 4000, result_id: "r1", cell: 4000 },
        ]),
      ),
    );
    expect(wrong).toMatchObject({ pass: false, tags: ["wrong_aggregation"] });
  });

  it("tags unverified answers and SQL errors", () => {
    const t = task({ kind: "number", value: 10 });
    const s = scoreRun(
      t,
      view(
        answer("It is 12.", [{ value: 12, result_id: "r1", ok: false }], {
          verified: false,
        }),
        [],
        [
          errorEvent(
            'Binder Error: Referenced column "mass" not found in FROM clause!',
          ),
          errorEvent('Parser Error: syntax error at or near "FROM"'),
        ],
      ),
    );
    expect(s.tags.sort()).toEqual([
      "dialect_error",
      "hallucinated_number",
      "wrong_column",
    ]);
  });

  it("matches tables against any result the run produced", () => {
    const value = table(["country"], [["Germany"], ["France"]]);
    const t = task({ kind: "set", value });
    const exact = stored(
      "r1",
      ["c", "n"],
      [
        ["Germany", 4],
        ["France", 1],
      ],
    );
    const broader = stored(
      "r2",
      ["c", "n"],
      [
        ["United Kingdom", 86],
        ["Germany", 4],
        ["France", 1],
      ],
    );
    const cites = answer("Germany and France", [
      { value: 4, result_id: "r2", cell: 4 },
    ]);
    expect(scoreRun(t, view(cites, [exact, broader])).pass).toBe(true);
    expect(scoreRun(t, view(cites, [broader])).pass).toBe(false);
  });

  it("reads a one-row answer from a ranking or from the text", () => {
    const value = table(["dteday", "total"], [["2012-09-15", 8714]]);
    const t = task({ kind: "table", value });
    const ranking = stored(
      "r1",
      ["d", "t"],
      [
        ["2012-09-15", 8714],
        ["2012-09-29", 8555],
      ],
    );
    expect(scoreRun(t, view(answer("top day"), [ranking])).pass).toBe(true);
    expect(
      scoreRun(
        t,
        view(
          answer("The busiest day was September 15, 2012 with 8,714 rentals."),
        ),
      ).pass,
    ).toBe(true);
    expect(
      scoreRun(
        t,
        view(
          answer("The busiest day was September 29, 2012 with 8,714 rentals."),
        ),
      ).pass,
    ).toBe(false);
  });

  it("checks a chart's mark and data", () => {
    const value = table(
      ["species", "n"],
      [
        ["Adelie", 152],
        ["Gentoo", 124],
      ],
    );
    const t = task({ kind: "chart", value, chart_checks: { marks: ["bar"] } });
    const r1 = stored(
      "r1",
      ["s", "n"],
      [
        ["Gentoo", 124],
        ["Adelie", 152],
      ],
    );
    const chart = (mark: "bar" | "arc"): ChartRecord => ({
      chart_id: "c1",
      result_id: "r1",
      rows: 2,
      spec: {
        mark,
        encoding: {
          x: { field: "s", type: "nominal" },
          y: { field: "n", type: "quantitative" },
        },
      },
    });
    expect(
      scoreRun(t, view(answer("chart", [], { charts: [chart("bar")] }), [r1]))
        .pass,
    ).toBe(true);
    expect(
      scoreRun(t, view(answer("chart", [], { charts: [chart("arc")] }), [r1]))
        .pass,
    ).toBe(false);
    expect(scoreRun(t, view(answer("no chart"), [r1])).detail).toBe(
      "no chart in the answer",
    );
  });

  it("scores clarify, refuse, and stops", () => {
    const ask: Outcome = {
      kind: "ask_user",
      question: "Which column?",
      options: [],
    };
    expect(scoreRun(task({ kind: "clarify" }), view(ask)).pass).toBe(true);
    expect(
      scoreRun(task({ kind: "number", value: 1 }), view(ask)).tags,
    ).toEqual(["asked_needlessly"]);
    expect(
      scoreRun(
        task({ kind: "refuse" }),
        view(answer("no lifespan column")),
        true,
      ).pass,
    ).toBe(true);
    expect(
      scoreRun(task({ kind: "refuse" }), view(answer("5 years")), false).tags,
    ).toEqual(["did_not_decline"]);
    expect(
      scoreRun(task({ kind: "clarify" }), view(answer("5 years"))).tags,
    ).toEqual(["did_not_ask"]);
    const stop: Outcome = { kind: "stopped", reason: "step_cap", message: "" };
    expect(
      scoreRun(task({ kind: "number", value: 1 }), view(stop)).tags,
    ).toEqual(["gave_up"]);
  });
});

describe("refusal rule", () => {
  it("spots answers that say the data can't answer", () => {
    expect(
      saysCannotAnswer("The dataset does not contain lifespan information."),
    ).toBe(true);
    expect(saysCannotAnswer("There is no column for rider gender.")).toBe(true);
    expect(saysCannotAnswer("The data only covers December 2010.")).toBe(true);
    expect(saysCannotAnswer("The average body mass is 5,076 g.")).toBe(false);
  });
});

describe("cacheKey", () => {
  it("ignores query timings in tool results", () => {
    const msgs = (ms: number) => [
      { role: "user" as const, content: "q" },
      {
        role: "tool" as const,
        tool_call_id: "c1",
        content: `{"result_id":"r1","elapsed_ms":${ms}}`,
      },
    ];
    expect(cacheKey("m", msgs(3))).toBe(cacheKey("m", msgs(250)));
    expect(cacheKey("m", msgs(3))).not.toBe(cacheKey("other", msgs(3)));
  });
});
