import { describe, expect, it } from "vitest";
import { checkKeyNumbers, matchesCell } from "./answer.ts";
import type { StoredResult } from "./sandbox.ts";

describe("matchesCell", () => {
  it.each([
    [5076.02, 5076.016260162602],
    [5076, 5076.016260162602],
    [5076.0, 5076.4],
    [1230000, 1234567],
    [1235000, 1234567],
    [12.5, 0.125],
    [12.35, 0.12349],
    [-3.2, -3.19],
    [0, 0],
    [42, "42"],
  ])("accepts %s for cell %s", (value, cell) => {
    expect(matchesCell(value, cell)).toBe(true);
  });

  it.each([
    [5200, 5076.016260162602],
    [5076.1, 5076.016260162602],
    [5000, 5076.016260162602],
    [45, 45.6],
    [14, 0.125],
    [1, null],
    [2011, "2011-01-01"],
  ])("rejects %s for cell %s", (value, cell) => {
    expect(matchesCell(value, cell)).toBe(false);
  });
});

describe("checkKeyNumbers", () => {
  const r1: StoredResult = {
    id: "r1",
    columns: [
      { name: "species", type: "VARCHAR" },
      { name: "Mean_Mass", type: "DOUBLE" },
    ],
    rows: [
      ["Gentoo", 5076.02],
      ["Adelie", 3700.66],
    ],
    truncated: false,
  };
  const get = (id: string) => (id === "r1" ? r1 : undefined);
  const answer = (k: Record<string, unknown>) => ({
    answer_markdown: "x",
    key_numbers: [
      {
        label: "mass",
        value: 3700.7,
        result_id: "r1",
        column: "Mean_Mass",
        ...k,
      },
    ],
  });

  it("finds the cited cell, with a case-insensitive column fallback", () => {
    expect(
      checkKeyNumbers(answer({ row: 1, column: "mean_mass" }), get),
    ).toEqual([{ ok: true, cell: 3700.66, column: "Mean_Mass", row: 1 }]);
  });

  it("explains each kind of problem", () => {
    const problem = (k: Record<string, unknown>) =>
      checkKeyNumbers(answer(k), get)[0]?.problem;
    expect(problem({ result_id: "r9", row: 1 })).toContain(
      "r9, which doesn't exist",
    );
    expect(problem({ column: "mass", row: 1 })).toContain(
      'columns "species", "Mean_Mass"',
    );
    expect(problem({ row: 2 })).toContain("has 2 row(s)");
    expect(problem({})).toContain("r1.Mean_Mass row 0, which is 5076.02");
  });
});
