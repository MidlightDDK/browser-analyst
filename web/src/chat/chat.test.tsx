// @vitest-environment jsdom
import { defensesFrom, type StoredResult } from "@browser-analyst/agent";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StepView } from "../agent/useAgent";
import { DefensesContext } from "../security/defenses";
import { FinalAnswer } from "./FinalAnswer";
import { Markdown } from "./Markdown";
import { StepCard } from "./StepCard";

afterEach(cleanup);

const r2: StoredResult = {
  id: "r2",
  columns: [
    { name: "species", type: "VARCHAR" },
    { name: "mean_mass", type: "DOUBLE" },
  ],
  rows: [
    ["Gentoo", 5076.02],
    ["Chinstrap", 3733.09],
    ["Adelie", 3700.66],
  ],
  truncated: false,
};

const step: StepView = {
  id: "2",
  text: "Average the mass per species.",
  provider: "gemini",
  model: "gemini-3.8-flash",
  tokens: { input_tokens: 1234, output_tokens: 56 },
  durationMs: 850,
  tools: [
    {
      id: "2.1",
      tool: "run_sql",
      input: { sql: "SELECT oops", purpose: "first try" },
      output: { error: 'Parser Error: syntax error at or near "oops"' },
      ok: false,
      summary: "error: Parser Error",
      durationMs: 3,
    },
    {
      id: "2.2",
      tool: "run_sql",
      input: {
        sql: "SELECT species, avg(body_mass_g) AS mean_mass FROM penguins GROUP BY 1",
        purpose: "mean mass by species",
      },
      output: {
        result_id: "r2",
        columns: r2.columns,
        row_count: 3,
        preview: r2.rows,
        truncated: false,
        elapsed_ms: 12,
      },
      ok: true,
      summary: "3 row(s) (r2)",
      durationMs: 14,
    },
  ],
};

describe("StepCard", () => {
  it("shows the plan, the model, highlighted SQL, errors, and result previews", () => {
    render(<StepCard step={step} />);
    const card = screen.getByRole("article", { name: "Step 2" });
    expect(card.textContent).toContain("gemini · gemini-3.8-flash");
    expect(card.textContent).toContain("1,234 in / 56 out tokens");
    expect(
      within(card).getByText("Average the mass per species."),
    ).toBeTruthy();
    expect(
      within(card).getByText(/Parser Error: syntax error/).textContent,
    ).toContain("Error:");
    expect(within(card).getAllByText("SELECT")[0]?.className).toContain(
      "font-semibold",
    );
    const preview = within(card).getByRole("table", {
      name: "Preview of result r2",
    });
    expect(within(preview).getAllByRole("row")).toHaveLength(4);
    expect(card.textContent).toContain("r2 · 3 rows · 12 ms");
  });
});

describe("StepCard tools", () => {
  it("shows Python code, its printed output, and its result preview", () => {
    render(
      <StepCard
        step={{
          id: "3",
          text: "",
          tools: [
            {
              id: "3.1",
              tool: "run_python",
              input: {
                code: "import numpy as np\nresult = df.describe()",
                input_result_ids: ["r2"],
                purpose: "summary stats",
              },
              output: {
                stdout: "hello\n",
                result_id: "r3",
                columns: [{ name: "n", type: "BIGINT" }],
                row_count: 1,
                preview: [[3]],
                truncated: false,
                elapsed_ms: 40,
                startup_ms: 6100,
              },
              ok: true,
              summary: "1 row(s) (r3)",
              durationMs: 6200,
            },
            {
              id: "3.2",
              tool: "make_chart",
              input: {},
              output: {
                chart_id: "c1",
                result_id: "r2",
                rows: 3,
                spec: { mark: "bar", title: "Mass", encoding: {} },
              },
              ok: true,
              summary: "chart c1",
              durationMs: 1,
            },
          ],
        }}
        chartsInAnswer={new Set(["c1"])}
      />,
    );
    const card = screen.getByRole("article", { name: "Step 3" });
    expect(card.textContent).toContain("Python: summary stats");
    expect(within(card).getByText("import").className).toContain(
      "font-semibold",
    );
    expect(within(card).getByLabelText("Printed output").textContent).toBe(
      "hello\n",
    );
    expect(card.textContent).toContain(
      "r3 · 1 row · 40 ms · Python started in 6.10 s",
    );
    expect(card.textContent).toContain(
      "Drew chart c1 (Mass) from r2; it’s shown with the answer",
    );
  });
});

describe("FinalAnswer", () => {
  const sourceFor = (id: string) =>
    id === "r2"
      ? {
          language: "sql" as const,
          code: "SELECT species, avg(body_mass_g) AS mean_mass",
        }
      : undefined;
  const answer = {
    answer_markdown: "**Gentoo** penguins are heaviest.",
    key_numbers: [
      {
        label: "Gentoo mean mass (g)",
        value: 5076,
        result_id: "r2",
        column: "mean_mass",
        row: 0,
      },
      {
        label: "Adelie mean mass (g)",
        value: 3900,
        result_id: "r2",
        column: "mean_mass",
        row: 2,
      },
    ],
    caveats: ["Two rows lack a body mass."],
  };

  it("links each key number to its cited cell and query", () => {
    render(
      <FinalAnswer
        answer={answer}
        checks={[
          { ok: true, cell: 5076.02, column: "mean_mass", row: 0 },
          {
            ok: false,
            cell: 3700.66,
            column: "mean_mass",
            row: 2,
            problem: "x",
          },
        ]}
        verified={false}
        getResult={(id) => (id === "r2" ? r2 : undefined)}
        sourceFor={sourceFor}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "1 key number didn’t match",
    );
    expect(screen.getByText("Gentoo").tagName).toBe("STRONG");
    expect(screen.getByText(/✓ matches r2.mean_mass row 0/)).toBeTruthy();
    expect(
      screen.getByText(
        /✕ doesn’t match r2.mean_mass row 2 \(cell is 3700.66\)/,
      ),
    ).toBeTruthy();

    const link = screen.getByRole("button", { name: /Adelie mean mass/ });
    expect(link.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(link);
    expect(link.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/AS/).closest("pre")?.textContent).toContain(
      "avg(body_mass_g)",
    );
    const cited = screen.getByLabelText("cited: 3700.66");
    expect(cited.tagName).toBe("TD");
    expect(screen.getByText("Two rows lack a body mass.")).toBeTruthy();
  });
});

describe("Markdown", () => {
  it("renders formatting but never HTML, images, or live links", () => {
    const { container } = render(
      <Markdown
        text={[
          "Revenue **rose** by `12%`.",
          "- one",
          "- two",
          '<img src="https://evil.example/x.png"> ![chart](https://evil.example/c.png)',
          "See [the docs](https://evil.example/leak?d=secret).",
        ].join("\n")}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("rose");
    expect(container.querySelector("code")?.textContent).toBe("12%");
    expect(container.textContent).toContain(
      '<img src="https://evil.example/x.png">',
    );
    expect(container.textContent).toContain("[image removed: chart]");
    expect(container.textContent).toContain(
      "the docs (https://evil.example/leak?d=secret)",
    );
  });

  it("renders images and links naively with the sanitizer off (red team only)", () => {
    const { container } = render(
      <DefensesContext value={defensesFrom("sanitizer")}>
        <Markdown text="![x](https://evil.example/c.png) [go](https://evil.example/l) [js](javascript:alert(1)) <b>raw</b>" />
      </DefensesContext>,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://evil.example/c.png",
    );
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("b")).toBeNull();
  });
});
