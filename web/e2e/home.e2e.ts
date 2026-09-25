import { expect, test } from "@playwright/test";
import { trackErrors } from "./errors";

test("home shows the headline and samples with no console errors", async ({
  page,
}) => {
  const errors = trackErrors(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your data never leaves your browser.",
  );
  await expect(
    page.getByRole("button", { name: /^Open the .* sample$/ }),
  ).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("/api/health returns JSON", async ({ request }) => {
  test.skip(!process.env.E2E_BASE_URL, "needs the Worker (deployed site)");
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok" });
});
