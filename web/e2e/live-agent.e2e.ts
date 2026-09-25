// Live runs of the sample questions against a real gateway: `E2E_LIVE=1` with
// E2E_BASE_URL pointing at `wrangler dev` (Turnstile test keys) or the
// deployed site. Spends free-tier LLM quota, so it never runs by default.
import { expect, test } from "@playwright/test";
import { SAMPLES } from "../src/samples";
import { trackErrors } from "./errors";

test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 to spend real LLM quota");
test.describe.configure({ mode: "serial" });

const only = process.env.E2E_QUESTIONS?.split(",").map(Number);
const questions = SAMPLES.flatMap((s) =>
  s.questions.map((q) => ({ sample: s, question: q })),
).filter((_, i) => !only || only.includes(i));

for (const { sample, question } of questions) {
  test(`live: ${question}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = trackErrors(page);
    // Without its recording, a sample question fills the box for a live run.
    await page.route("**/replays/**", (route) => route.fulfill({ json: {} }));
    await page.goto("/");
    await page.getByRole("button", { name: question }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const outcome = page
      .getByRole("region", { name: "Answer" })
      .or(page.getByRole("region", { name: "Question from the agent" }))
      .or(page.getByRole("alert"))
      .or(page.getByRole("status").filter({ hasText: /quota|requests/ }));
    await expect(outcome.first()).toBeVisible({ timeout: 200_000 });
    const trace = await page
      .getByRole("list", { name: `Trace of: ${question}` })
      .innerText();
    const summary = await page
      .getByText(/\d+ steps? · [\d,]+ in \/ [\d,]+ out tokens/)
      .first()
      .innerText()
      .catch(() => "(no summary)");
    console.log(
      `\n=== ${sample.title}: ${question}\n${summary}\n${(await outcome.first().innerText()).slice(0, 1200)}\n--- trace\n${trace.slice(0, 2500)}`,
    );
    const answer = page.getByRole("region", { name: "Answer" });
    await expect(answer).toBeVisible();
    await expect(answer).toContainText("✓ matches");
    await expect(answer).not.toContainText("didn’t match");
    // CSP violations and page errors show up as console errors.
    expect(errors).toEqual([]);
  });
}
