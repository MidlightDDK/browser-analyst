import { contractCases } from "@browser-analyst/agent/sandbox.contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeDuckDBSandbox } from "./duckdb-node.ts";

describe("Node DuckDB sandbox contract", () => {
  let sandbox: NodeDuckDBSandbox;
  beforeAll(async () => {
    sandbox = await NodeDuckDBSandbox.create();
  });
  afterAll(() => sandbox.close());

  for (const c of contractCases) it(c.name, () => c.run(sandbox));

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
