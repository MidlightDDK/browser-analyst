// Phone-width pass: no screen scrolls sideways at 375 px (wide tables scroll
// inside their own box), and the workspace shows one panel at a time.
import { expect, type Page, test } from "@playwright/test";
import { trackErrors } from "./errors";

test.use({
  viewport: { width: 375, height: 740 },
  isMobile: true,
  hasTouch: true,
});

/** Up to 5 elements past the right edge of the screen that no scrollable box clips. */
function sticksOut(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clipped = (el: Element) => {
      // Absolute boxes escape a scroll box that isn't positioned (sr-only text).
      if (/absolute|fixed/.test(getComputedStyle(el).position)) return false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p === document.body) return false;
        if (getComputedStyle(p).overflowX !== "visible") return true;
      }
      return false;
    };
    return [...document.body.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .filter((el) => !clipped(el))
      .slice(0, 5)
      .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}">`);
  });
}

async function expectFits(page: Page) {
  const extra = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(extra, `sticks out: ${(await sticksOut(page)).join(" ")}`).toBe(0);
}

for (const [path, heading] of [
  ["/", "Your data never leaves your browser."],
  ["/benchmark", "Benchmark"],
  ["/security", "Red-team results"],
] as const) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      heading,
    );
    if (path !== "/")
      await expect(page.getByRole("table").first()).toBeVisible();
    await expectFits(page);
    expect(errors).toEqual([]);
  });
}

test("the workspace shows one panel at a time on a phone", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "How does flipper length relate to body mass for each species?",
    })
    .click();
  await page
    .getByRole("region", { name: "Replay" })
    .getByRole("button", { name: "Skip to the end" })
    .click();
  await expect(
    page.getByRole("region", { name: "Answer" }).getByRole("figure"),
  ).toBeVisible();
  await expectFits(page);

  const tabs = page.getByRole("tablist", { name: "Workspace panels" });
  await tabs.getByRole("tab", { name: "Data" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "penguins" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Answer" })).toBeHidden();
  await expectFits(page);

  await tabs.getByRole("tab", { name: "Trace" }).click();
  await expect(page.getByText("run_sql:").first()).toBeVisible();
  await expectFits(page);
  expect(errors).toEqual([]);
});
