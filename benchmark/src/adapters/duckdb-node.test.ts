import { readFile } from "node:fs/promises";
import { PYODIDE_VERSION } from "@browser-analyst/agent";
import { contractCases } from "@browser-analyst/agent/sandbox.contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeDuckDBSandbox } from "./duckdb-node.ts";

describe("Node DuckDB sandbox contract", () => {
  let sandbox: NodeDuckDBSandbox;
  beforeAll(async () => {
    sandbox = await NodeDuckDBSandbox.create();
  });
  afterAll(() => sandbox.close());

  // Python cases include Pyodide's first start (packages download once).
  for (const c of contractCases) it(c.name, () => c.run(sandbox), 180_000);

  it("runs the same Pyodide release the browser loads", async () => {
    const pkg = JSON.parse(
      await readFile(
        new URL("../../node_modules/pyodide/package.json", import.meta.url),
        "utf8",
      ),
    ) as { version: string };
    expect(pkg.version).toBe(PYODIDE_VERSION);
  });

  it("cannot read local files outside the upload directory", async () => {
    const outside = new URL(
      "../../package.json",
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const result = await sandbox.sql(`SELECT * FROM "${outside}"`);
    expect(result).toMatchObject({
      error: expect.stringMatching(/disabled by configuration|Permission/),
    });
  });
});
