import { expect, test } from "@playwright/test";

test("home shows the placeholder with no console errors", async ({ page }) => {
  // CSP violations surface as console errors in Chromium.
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your data never leaves your browser.",
  );
  await expect(page.getByRole("status")).toContainText("Under construction");
  expect(errors).toEqual([]);
});

test("/api/health returns JSON", async ({ request }) => {
  test.skip(!process.env.E2E_BASE_URL, "needs the Worker (deployed site)");
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok" });
});
