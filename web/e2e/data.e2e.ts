import { expect, type Page, test } from "@playwright/test";
import { trackErrors } from "./errors";

const SAMPLES = [
  {
    title: "Palmer Penguins",
    table: "penguins",
    column: "body_mass_g",
    type: "BIGINT",
    cell: "Adelie",
  },
  {
    title: "Bike Sharing, hourly",
    table: "bike_sharing_hourly",
    column: "dteday",
    type: "DATE",
    cell: "2011-01-01",
  },
  {
    title: "Online Retail, one week",
    table: "online_retail_week",
    column: "InvoiceDate",
    type: "TIMESTAMP",
    cell: "WHITE HANGING HEART T-LIGHT HOLDER",
  },
];

async function expectLoaded(
  page: Page,
  table: string,
  column: string,
  type: string,
  cell: string,
) {
  await expect(
    page.getByRole("heading", { level: 1, name: table }),
  ).toBeVisible({
    timeout: 60_000,
  });
  const profile = page.getByRole("table", {
    name: `Column profile of ${table}`,
  });
  const row = profile.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: column, exact: true }),
  });
  await expect(row).toContainText(type);
  await expect(
    page.getByRole("table", { name: `Rows of ${table}` }),
  ).toContainText(cell);
  await expect(page.getByTestId("timing")).toContainText(
    /loaded in .+, profiled in .+/,
  );
}

for (const s of SAMPLES) {
  test(`the ${s.title} sample loads and profiles`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await page.goto("/");
    await page
      .getByRole("button", { name: `Open the ${s.title} sample` })
      .click();
    await expectLoaded(page, s.table, s.column, s.type, s.cell);
    await expect(
      page.getByText(/^DuckDB v1\.5\.4 in your browser/),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("an uploaded CSV loads and profiles; an unknown type gets a friendly error", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto("/");
  await page.getByLabel("Choose data files").setInputFiles({
    name: "My Sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("region,amount\nNorth,10.5\nSouth,20\n"),
  });
  await expectLoaded(page, "my_sales", "amount", "DOUBLE", "South");

  await page.getByLabel("Choose data files").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Unsupported file type: notes.txt",
  );
  expect(errors).toEqual([]);
});
