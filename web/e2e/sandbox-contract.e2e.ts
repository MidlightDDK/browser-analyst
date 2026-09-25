import { expect, test } from "@playwright/test";

// Set by web/src/sandbox/contract-harness.ts.
declare global {
  interface Window {
    runContract?: () => Promise<{
      version: string;
      outcomes: { name: string; ms: number; error?: string }[];
    }>;
  }
}

test("DuckDB-WASM and Pyodide pass the shared sandbox contract", async ({
  page,
}) => {
  test.skip(
    !!process.env.E2E_BASE_URL,
    "contract.html exists only on the dev server",
  );
  test.setTimeout(300_000); // includes Pyodide's first start
  await page.goto("/contract.html");
  await page.waitForFunction(() => typeof window.runContract === "function");
  const { version, outcomes } = await page.evaluate(() => {
    if (!window.runContract) throw new Error("harness missing");
    return window.runContract();
  });
  expect(version).toBe("v1.5.4"); // same engine as the Node twin (@duckdb/node-api 1.5.4)
  expect(outcomes.length).toBeGreaterThanOrEqual(20);
  for (const o of outcomes) expect.soft(o.error, o.name).toBeUndefined();
});
