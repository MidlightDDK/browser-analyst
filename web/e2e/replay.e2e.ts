// Sample questions play recorded runs (web/public/replays/) with no model
// call; "Run live" then asks the (scripted) gateway, and replays keep working
// when every provider is down.
import { expect, test } from "@playwright/test";
import { trackErrors } from "./errors";
import { mockGateway } from "./gateway";

// Loading DuckDB-WASM and a sample alone may take up to 60 s on a busy runner.
test.describe.configure({ timeout: 120_000 });

const CHART_QUESTION =
  "How does flipper length relate to body mass for each species?";
const QUESTION = "Which species has the heaviest average body mass?";

test("a sample question plays its recording, then Run live draws a chart", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const bodies = await mockGateway(page, [
    [
      "run_sql",
      {
        sql: "SELECT species, flipper_length_mm, body_mass_g FROM penguins WHERE body_mass_g IS NOT NULL",
        purpose: "flipper length and mass per penguin",
      },
    ],
    [
      "make_chart",
      {
        result_id: "r1",
        spec: {
          mark: "point",
          title: "Flipper length vs body mass",
          encoding: {
            x: { field: "flipper_length_mm", type: "quantitative" },
            y: { field: "body_mass_g", type: "quantitative" },
            color: { field: "species", type: "nominal" },
          },
        },
      },
    ],
    [
      "final_answer",
      {
        answer_markdown: "Longer flippers go with heavier penguins.",
        key_numbers: [],
        chart_ids: ["c1"],
      },
    ],
  ]);
  await page.goto("/");
  await page.getByRole("button", { name: CHART_QUESTION }).click();

  const banner = page.getByRole("region", { name: "Replay" });
  await expect(banner).toContainText("Replay of a real run:");
  // Original timing: the first step shows well before the answer.
  await expect(page.getByRole("article", { name: "Step 1" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("region", { name: "Answer" })).toHaveCount(0);
  const fast = banner.getByRole("button", { name: "2×" });
  await fast.click();
  await expect(fast).toHaveAttribute("aria-pressed", "true");
  await banner.getByRole("button", { name: "Skip to the end" }).click();
  const recorded = page.getByRole("region", { name: "Answer" });
  await expect(recorded.getByRole("figure")).toBeVisible();
  await expect(banner.getByRole("button", { name: "2×" })).toHaveCount(0);
  expect(bodies).toHaveLength(0);

  await expect(
    page.getByRole("heading", { level: 1, name: "penguins" }),
  ).toBeVisible({ timeout: 60_000 });
  await banner.getByRole("button", { name: "Run live" }).click();
  const live = page.getByRole("region", { name: "Answer" }).nth(1);
  const points = live
    .getByRole("figure", { name: "Chart c1: Flipper length vs body mass" })
    .locator('[aria-roledescription="point"]');
  await expect(points).toHaveCount(342, { timeout: 30_000 });
  expect(bodies).toHaveLength(3);
  // The live run doesn't inherit the recording's answer or result ids.
  expect(JSON.stringify(bodies[0])).not.toContain(
    "Earlier in this conversation",
  );
  expect(errors).toEqual([]);
});

test("replays play when every provider is down", async ({ page }) => {
  const bodies = await mockGateway(page, []); // every step: 503 quota
  await page.goto("/");
  await page.getByRole("button", { name: QUESTION }).click();
  const answer = page.getByRole("region", { name: "Answer" });
  await expect(answer).toContainText("Gentoo", { timeout: 30_000 });
  await expect(answer).toContainText("✓ matches");
  expect(bodies).toHaveLength(0);

  // A live run hits the quota and offers the recording instead.
  await expect(
    page.getByRole("heading", { level: 1, name: "penguins" }),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Run live" }).click();
  const quota = page.getByRole("status").filter({ hasText: "quota" });
  await expect(quota).toContainText("The free AI quota is used up for now");
  await quota
    .getByRole("button", { name: "Watch a recorded run of this question" })
    .click();
  await expect(page.getByRole("region", { name: "Replay" })).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Answer" })).toHaveCount(2, {
    timeout: 30_000,
  });
});
