import { describe, expect, it } from "vitest";
import {
  buildMessages,
  compactCatalog,
  profileContent,
  type StepRecord,
  type StepToolRecord,
  sqlResultContent,
} from "./context.ts";
import type { TableProfile } from "./sandbox.ts";
import { TOOL_BY_NAME, type ToolDef } from "./tools/schemas.ts";
import { validateArgs } from "./tools/validate.ts";
import {
  byteLength,
  MAX_MESSAGES,
  MAX_MESSAGES_BYTES,
  MAX_TOOL_MESSAGE_BYTES,
  messagesBytes,
} from "./wire.ts";

const wide = (cols: number): TableProfile => ({
  table: "Sales Data",
  rows: 1000,
  columns: Array.from({ length: cols }, (_, i) => ({
    name: i % 2 ? `metric_${i}` : `Label ${i}`,
    type: i % 2 ? "DOUBLE" : "VARCHAR",
    null_pct: i === 0 ? 1.5 : 0,
    approx_distinct: i % 2 ? 900 : 4,
    min: i % 2 ? 0 : "a",
    max: i % 2 ? 99.5 : "d",
    top_values: i % 2 ? [] : ["a", "b", "c", "d"],
  })),
  sample_rows: [Array.from({ length: cols }, () => "x".repeat(60))],
});

describe("compactCatalog", () => {
  it("lists columns with types, nulls, and ranges or top values", () => {
    const text = compactCatalog([{ profile: wide(2), source: "sales.csv" }]);
    expect(text).toBe(
      [
        'Table "Sales Data": 1000 rows, 2 columns (from file "sales.csv")',
        '- "Label 0" VARCHAR · 1.5% null · ~4 distinct · top: "a", "b", "c", "d"',
        "- metric_1 DOUBLE · 0 to 99.5",
      ].join("\n"),
    );
  });

  it("cuts wide tables short and points to describe_table", () => {
    const text = compactCatalog([{ profile: wide(400) }], 2000);
    expect(text.length).toBeLessThan(2100);
    expect(text).toMatch(/more columns: call describe_table$/);
  });
});

describe("tool result compaction", () => {
  it("fits large results in a tool message, keeping the id and row count", () => {
    const content = sqlResultContent({
      result_id: "r7",
      columns: [{ name: "note", type: "VARCHAR" }],
      row_count: 5000,
      preview: Array.from({ length: 20 }, () => ["é".repeat(200)]),
      truncated: false,
      elapsed_ms: 3,
    });
    expect(byteLength(content)).toBeLessThanOrEqual(MAX_TOOL_MESSAGE_BYTES);
    expect(JSON.parse(content)).toMatchObject({
      result_id: "r7",
      row_count: 5000,
      preview_note: expect.stringContaining("to fit the size limit"),
    });
    expect(byteLength(profileContent(wide(300)))).toBeLessThanOrEqual(
      MAX_TOOL_MESSAGE_BYTES,
    );
  });
});

describe("buildMessages", () => {
  const step = (index: number): StepRecord => ({
    index,
    text: "",
    calls: [
      {
        call: {
          id: `c${index}`,
          name: "run_sql",
          arguments: JSON.stringify({ sql: "x".repeat(900) }),
        },
        content: "y".repeat(3500),
        summary: `4 row(s) (r${index})`,
        ok: true,
      },
    ],
  });

  it("stays within the gateway caps by collapsing more steps", () => {
    const steps = Array.from({ length: 10 }, (_, i) => step(i + 1));
    const messages = buildMessages({
      catalog: compactCatalog([{ profile: wide(100) }]),
      question: "q",
      steps,
    });
    expect(messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(messagesBytes(messages)).toBeLessThanOrEqual(MAX_MESSAGES_BYTES);
    expect(messages[0]?.content).toContain("step 1: run_sql → 4 row(s) (r1)");
    expect(messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "c10",
    });
  });

  it("keeps thought signatures but doesn't count them toward the byte cap", () => {
    const s = step(1);
    (s.calls[0] as StepToolRecord).call.extra_content = {
      google: { thought_signature: "z".repeat(30_000) },
    };
    const messages = buildMessages({ catalog: "t", question: "q", steps: [s] });
    const assistant = messages[1];
    expect(
      assistant?.role === "assistant" &&
        assistant.tool_calls?.[0]?.extra_content,
    ).toBeTruthy();
    expect(messagesBytes(messages)).toBeLessThan(MAX_MESSAGES_BYTES);
  });
});

describe("validateArgs", () => {
  const schema = (TOOL_BY_NAME.get("final_answer") as ToolDef).parameters;
  it("accepts a valid final answer and names the first problem otherwise", () => {
    const ok = {
      answer_markdown: "a",
      key_numbers: [
        { label: "l", value: 1, result_id: "r1", column: "c", row: 0 },
      ],
      caveats: [],
    };
    expect(validateArgs(schema, ok)).toBeNull();
    expect(
      validateArgs(schema, {
        ...ok,
        key_numbers: [{ ...ok.key_numbers[0], value: "1" }],
      }),
    ).toBe("arguments.key_numbers[0].value must be a number, not a string");
    expect(
      validateArgs(schema, {
        ...ok,
        key_numbers: [{ ...ok.key_numbers[0], row: 1.5 }],
      }),
    ).toBe("arguments.key_numbers[0].row must be an integer");
    expect(validateArgs(schema, [])).toBe(
      "arguments must be an object, not an array",
    );
  });
});
