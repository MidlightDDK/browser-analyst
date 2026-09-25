// Runs the shared sandbox contract against DuckDB-WASM (loaded by contract.html).

import { contractCases } from "@browser-analyst/agent/sandbox.contract";
import { BrowserDuckDBSandbox } from "./duckdb";

export interface ContractOutcome {
  name: string;
  ms: number;
  error?: string;
}

declare global {
  interface Window {
    runContract?: () => Promise<{
      version: string;
      outcomes: ContractOutcome[];
    }>;
  }
}

window.runContract = async () => {
  const sandbox = await BrowserDuckDBSandbox.create();
  const outcomes: ContractOutcome[] = [];
  for (const c of contractCases) {
    const start = performance.now();
    try {
      await c.run(sandbox);
      outcomes.push({
        name: c.name,
        ms: Math.round(performance.now() - start),
      });
    } catch (err) {
      outcomes.push({
        name: c.name,
        ms: Math.round(performance.now() - start),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await sandbox.close();
  return { version: sandbox.version, outcomes };
};
