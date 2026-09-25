// M3 with a scripted (mocked) gateway: charts render from result ids without
// their data reaching the model, run_python waits for the approval click, and
// a runaway Python loop is stopped at 15 s while the agent recovers. SQL runs
// in the page's DuckDB and Python in its Pyodide worker.
import { expect, type Page, test } from "@playwright/test";
import { trackErrors } from "./errors";

// Loading DuckDB-WASM and a sample alone may take up to 60 s on a busy runner.
test.describe.configure({ timeout: 120_000 });

const SAMPLE = "Which species has the heaviest average body mass?";

type Body = { messages: { role: string; content: string | null }[] };

const sse = (events: [string, unknown][]) =>
  events
    .map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
    .join("");

const step = (name: string, args: unknown, n: number) =>
  sse([
    ["tool_call", { id: `t${n}`, name, arguments: JSON.stringify(args) }],
    [
      "done",
      {
        usage: { input_tokens: 1000, output_tokens: 50 },
        provider: "mock",
        model: "scripted-model",
        latencyMs: 5,
      },
    ],
  ]);

/** Mocks the bot check and session, and plays `script` as model steps. */
async function mockGateway(page: Page, script: [string, unknown][]) {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback("t")); return "w"; }, remove() {} };`,
    }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { expiresAt: Date.now() + 1_800_000 } }),
  );
  const bodies: Body[] = [];
  await page.route("**/api/agent/step", (route) => {
    bodies.push(route.request().postDataJSON());
    const next = script[bodies.length - 1];
    return next
      ? route.fulfill({
          contentType: "text/event-stream",
          body: step(next[0], next[1], bodies.length),
        })
      : route.fulfill({ status: 503, json: { reason: "quota" } });
  });
  return bodies;
}

async function openPenguins(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: SAMPLE }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "penguins" }),
  ).toBeVisible({ timeout: 60_000 });
}

test("a chart renders every row of its result while the model sees only the preview", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const bodies = await mockGateway(page, [
    [
      "run_sql",
      {
        sql: "SELECT bill_length_mm, body_mass_g FROM penguins WHERE body_mass_g IS NOT NULL ORDER BY body_mass_g, bill_length_mm",
        purpose: "bill length and mass per penguin",
      },
    ],
    [
      "make_chart",
      {
        result_id: "r1",
        spec: {
          mark: "point",
          title: "Bill length vs body mass",
          encoding: {
            x: { field: "body_mass_g", type: "quantitative" },
            y: { field: "bill_length_mm", type: "quantitative" },
          },
        },
      },
    ],
    [
      "final_answer",
      {
        answer_markdown: "Heavier penguins tend to have longer bills.",
        key_numbers: [],
        chart_ids: ["c1"],
      },
    ],
  ]);
  await openPenguins(page);
  await page.getByLabel("Your question").fill("Plot bill length against mass.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  const answer = page.getByRole("region", { name: "Answer" });
  const chart = answer.getByRole("figure", {
    name: "Chart c1: Bill length vs body mass",
  });
  const points = chart.locator('[aria-roledescription="point"]');
  await expect(points).toHaveCount(342, { timeout: 30_000 });
  await expect(chart).toContainText("drawn here from all 342 rows of r1");
  await expect(page.getByRole("article", { name: "Step 2" })).toContainText(
    "it’s shown with the answer",
  );

  // Every plotted point as the [bill, mass] row the model would have seen.
  const labels = await points.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? ""),
  );
  const pairs = new Set(
    labels.map((l) => {
      const n = (k: string) =>
        Number(
          new RegExp(`${k}: ([\\d.,]+)`).exec(l)?.[1]?.replaceAll(",", ""),
        );
      return `[${n("bill_length_mm")},${n("body_mass_g")}]`;
    }),
  );
  expect(pairs.size).toBeGreaterThan(300);
  const sent = JSON.stringify(bodies);
  const seen = [...pairs].filter((p) => sent.includes(p));
  expect(seen.length).toBeGreaterThan(0); // the preview rows match
  expect(seen.length).toBeLessThanOrEqual(20); // and nothing else does
  const chartReply = bodies[2]?.messages.at(-1)?.content ?? "";
  expect(chartReply).toContain('"chart_id":"c1"');
  expect(chartReply).not.toContain("bill_length_mm");
  expect(errors).toEqual([]);
});

test("run_python waits for the approval click", async ({ page }) => {
  test.setTimeout(180_000); // Pyodide's first start
  const errors = trackErrors(page);
  const bodies = await mockGateway(page, [
    [
      "run_sql",
      {
        sql: "SELECT species, round(avg(body_mass_g), 1) AS mean_mass FROM penguins GROUP BY species ORDER BY mean_mass DESC",
        purpose: "mean mass by species",
      },
    ],
    [
      "run_python",
      {
        code: "print(df.shape)\nresult = df.assign(mass_kg=(df['mean_mass'] / 1000).round(2))",
        input_result_ids: ["r1"],
        purpose: "convert to kilograms",
      },
    ],
    [
      "final_answer",
      {
        answer_markdown: "Gentoo penguins are heaviest, at about 5.08 kg.",
        key_numbers: [
          {
            label: "Gentoo mean mass (kg)",
            value: 5.08,
            result_id: "r2",
            column: "mass_kg",
          },
        ],
      },
    ],
  ]);
  await openPenguins(page);
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  const gate = page.getByRole("region", { name: "Approve Python" });
  await expect(gate).toContainText("convert to kilograms", { timeout: 30_000 });
  await expect(gate).toContainText("Inputs as DataFrames: r1");
  await page.waitForTimeout(1500);
  // Blocked: no Python ran and the model wasn't asked for another step.
  expect(bodies).toHaveLength(2);
  await expect(page.getByLabel("Printed output")).toHaveCount(0);

  await gate.getByRole("button", { name: "Run Python" }).click();
  await expect(gate).toBeHidden();
  const answer = page.getByRole("region", { name: "Answer" });
  await expect(answer).toContainText("✓ matches r2.mass_kg row 0", {
    timeout: 150_000,
  });
  const step2 = page.getByRole("article", { name: "Step 2" });
  await expect(step2.getByLabel("Printed output")).toHaveText("(3, 2)");
  await expect(step2).toContainText("Python started in");
  await answer.getByRole("button", { name: /Gentoo mean mass/ }).click();
  await expect(answer).toContainText("from this Python code");
  expect(JSON.stringify(bodies[2]?.messages.at(-1))).toContain("mass_kg");
  expect(errors).toEqual([]);
});

test("a runaway Python loop is stopped at 15 s and the agent recovers", async ({
  page,
}) => {
  test.setTimeout(240_000); // Pyodide starts twice: before and after the kill
  const errors = trackErrors(page);
  const bodies = await mockGateway(page, [
    // Starts Python first, so the timed run below excludes its startup.
    [
      "run_python",
      { code: "print('warm')", input_result_ids: [], purpose: "warm up" },
    ],
    [
      "run_python",
      { code: "while True:\n    pass", input_result_ids: [], purpose: "spin" },
    ],
    [
      "run_python",
      {
        code: "result = pd.DataFrame({'answer': [42]})",
        input_result_ids: [],
        purpose: "try again",
      },
    ],
    [
      "final_answer",
      {
        answer_markdown: "The answer is 42.",
        key_numbers: [
          { label: "answer", value: 42, result_id: "r1", column: "answer" },
        ],
      },
    ],
  ]);
  await openPenguins(page);
  await page.getByLabel("Ask before running Python").uncheck();
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(
    page.getByRole("article", { name: "Step 1" }).getByLabel("Printed output"),
  ).toHaveText("warm", { timeout: 150_000 });
  const started = Date.now();
  const step2 = page.getByRole("article", { name: "Step 2" });
  await expect(step2).toContainText("timed out after 15 s", {
    timeout: 30_000,
  });
  // Wall clock (page polling blurs it by a few hundred ms), then the trace's
  // own duration for the killed call.
  const stoppedAfter = Date.now() - started;
  expect(stoppedAfter).toBeGreaterThan(14_000);
  expect(stoppedAfter).toBeLessThan(18_000);
  const killed = await page
    .getByRole("list", { name: /^Trace of:/ })
    .getByRole("listitem")
    .filter({ hasText: "timed out after 15 s" })
    .textContent();
  const seconds = Number(/Tool 2\.1\s*(\d+\.\d\d) s/.exec(killed ?? "")?.[1]);
  expect(seconds).toBeGreaterThanOrEqual(15);
  expect(seconds).toBeLessThan(16.5);
  expect(JSON.stringify(bodies[2]?.messages.at(-1))).toContain(
    "timed out after 15 s",
  );
  // A fresh worker runs the next call.
  await expect(page.getByRole("region", { name: "Answer" })).toContainText(
    "✓ matches r1.answer row 0",
    { timeout: 120_000 },
  );
  expect(errors).toEqual([]);
});
