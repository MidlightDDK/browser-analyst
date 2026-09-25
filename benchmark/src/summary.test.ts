import { describe, expect, it } from "vitest";
import { type Baseline, gate, summarize, type TaskRecord } from "./summary.ts";

const rec = (
  id: string,
  category: string,
  pass: boolean,
  extra: Partial<TaskRecord> = {},
): TaskRecord => ({
  id,
  category,
  kind: "number",
  smoke: true,
  pass,
  detail: "",
  tags: pass ? [] : ["wrong_aggregation"],
  outcome: "answer",
  steps: 2,
  tool_calls: 2,
  tool_errors: 0,
  verified: true,
  tokens_in: 100,
  tokens_out: 10,
  wall_ms: 1000,
  model_calls: 2,
  cache_hits: 1,
  ...extra,
});

const meta = {
  model: "m",
  provider_model: "p",
  split: "smoke",
  prompt_version: "prompt-v2",
  toolset_version: "tools-v2",
  started_at: "2026-09-25T00:00:00Z",
  complete: true,
};

describe("summarize", () => {
  it("counts success per category and the run metrics", () => {
    const s = summarize(
      [
        rec("a", "filter", true),
        rec("b", "filter", false),
        rec("c", "join", true, {
          tool_errors: 1,
          tool_calls: 4,
          verified: false,
        }),
      ],
      meta,
    );
    expect(s.overall).toEqual({ tasks: 3, passed: 2, success: 66.7 });
    expect(s.by_category.join).toEqual({ tasks: 1, passed: 1, success: 100 });
    expect(s.metrics).toMatchObject({
      self_repair_rate: 1,
      tool_error_rate: 0.125,
      provenance_valid_rate: 0.667,
      cache_hit_rate: 0.5,
    });
    expect(s.failure_tags).toEqual({ wrong_aggregation: 1 });
  });
});

describe("gate", () => {
  const baseline = {
    smoke: { tasks: 15, passed: 12, success: 80 },
  } as Baseline;
  const smoke = (passed: number, complete = true) =>
    summarize(
      Array.from({ length: 15 }, (_, i) =>
        rec(String(i), "filter", i < passed),
      ),
      { ...meta, complete },
    );

  it("allows up to 5 points below the baseline's smoke success", () => {
    expect(gate(smoke(12), baseline)).toEqual({ ok: true, floor: 75 });
    // 11/15 = 73.3%: one task lost is 6.7 points.
    expect(gate(smoke(11), baseline).ok).toBe(false);
  });

  it("fails an incomplete run", () => {
    expect(gate(smoke(15, false), baseline).ok).toBe(false);
  });
});
