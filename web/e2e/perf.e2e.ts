// M1 acceptance: a 50 MB CSV loads and profiles; the measured time is printed
// and attached to the report (target < 5 s on a mid-range laptop). Then a
// typical aggregate over it, run by the agent's run_sql tool (target < 300 ms).

import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { mockGateway } from "./gateway";

const TARGET_BYTES = 50 * 1024 * 1024;

/** A deterministic CSV of about `bytes` bytes with mixed column types. */
function makeCsv(bytes: number): { csv: string; rows: number } {
  let seed = 42;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const categories = [
    "books",
    "garden",
    "toys",
    "music",
    "kitchen",
    "sports",
    "tools",
    "beauty",
  ];
  const cities = Array.from({ length: 200 }, (_, i) => `City ${i + 1}`);
  const lines = [
    "order_id,ordered_at,category,city,unit_price,quantity,discounted,note",
  ];
  let size = lines[0]?.length ?? 0;
  let id = 0;
  const start = Date.UTC(2023, 0, 1);
  while (size < bytes) {
    id++;
    const ts = new Date(start + Math.floor(rand() * 365 * 86_400_000))
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const line = [
      id,
      ts,
      categories[Math.floor(rand() * categories.length)],
      cities[Math.floor(rand() * cities.length)],
      (rand() * 200).toFixed(2),
      1 + Math.floor(rand() * 9),
      rand() < 0.2,
      rand() < 0.1 ? "" : `gift wrap ${Math.floor(rand() * 1000)}`,
    ].join(",");
    lines.push(line);
    size += line.length + 1;
  }
  return { csv: `${lines.join("\n")}\n`, rows: id };
}

test("a 50 MB CSV loads and profiles in the browser", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { csv, rows } = makeCsv(TARGET_BYTES);
  // Playwright caps in-memory uploads at 50 MB, so go through a file.
  const path = testInfo.outputPath("orders_50mb.csv");
  writeFileSync(path, csv);

  await page.goto("/");
  // Start the engine first so the measurement covers loading and profiling only.
  await page
    .getByRole("button", { name: "Open the Palmer Penguins sample" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "penguins" }),
  ).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("Choose data files").setInputFiles(path);
  await expect(
    page.getByRole("heading", { level: 1, name: "orders_50mb" }),
  ).toBeVisible({ timeout: 150_000 });
  const timing = page.getByTestId("timing");
  const loadMs = Number(await timing.getAttribute("data-load-ms"));
  const profileMs = Number(await timing.getAttribute("data-profile-ms"));
  await expect(page.getByRole("button", { name: /orders_50mb/ })).toContainText(
    `${rows.toLocaleString("en-US")} rows`,
  );

  await mockGateway(page, [
    [
      "run_sql",
      {
        sql: "SELECT category, count(*) AS orders, sum(unit_price * quantity) AS revenue FROM orders_50mb GROUP BY category ORDER BY revenue DESC",
        purpose: "revenue per category",
      },
    ],
    [
      "final_answer",
      {
        answer_markdown: "Revenue per category.",
        key_numbers: [],
        chart_ids: [],
      },
    ],
  ]);
  await page.getByLabel("Your question").fill("Revenue per category?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  // The trace times the tool: "Tool 1.1 245 ms".
  const tool = page.getByRole("listitem").filter({ hasText: "run_sql:" });
  await expect(tool).toContainText("8 row(s)", { timeout: 30_000 });
  const [, n, unit] =
    /Tool 1\.1\s*([\d.]+) (ms|s)/.exec(await tool.innerText()) ?? [];
  const queryMs = unit === "s" ? Number(n) * 1000 : Number(n);

  const mb = (Buffer.byteLength(csv) / 1024 / 1024).toFixed(1);
  const summary = `${mb} MB CSV, ${rows} rows: load ${loadMs} ms + profile ${profileMs} ms = ${loadMs + profileMs} ms; aggregate query ${queryMs} ms`;
  console.log(summary);
  testInfo.annotations.push({ type: "perf", description: summary });
  expect(loadMs).toBeGreaterThan(0);
  expect(profileMs).toBeGreaterThan(0);
  expect(queryMs).toBeGreaterThan(0);
});
