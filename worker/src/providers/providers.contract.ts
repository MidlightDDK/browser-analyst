// Provider contract (`pnpm test:providers`, needs GEMINI_API_KEY / GROQ_API_KEY
// in the root .env or the environment; spends a little free-tier quota). Each
// provider runs the real agent loop to a verified final_answer: tool calls,
// JSON arguments, tool results, and (for Gemini) thought signatures round-trip.
// Workers AI needs the binding, so it is checked through `wrangler dev`.

import {
  type AgentSandbox,
  type Cell,
  type ModelClient,
  ModelError,
  runAgent,
  type StoredResult,
} from "@browser-analyst/agent";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { PROVIDERS } from "./chain";
import { providerClient } from "./client";

const env = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
} as unknown as Env;

/** Waits out Gemini's "high demand" 503 spikes (up to 3 tries, 10 s apart). */
function patient(client: ModelClient): ModelClient {
  return {
    async step(req) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await client.step(req);
        } catch (err) {
          const busy =
            err instanceof ModelError && /HTTP 503/.test(err.message);
          if (!busy || attempt === 3) throw err;
          await new Promise((r) => setTimeout(r, 10_000));
        }
      }
    },
  };
}

const MEAN = 4201.754385964912;

/** Answers any query with one cell, named after the query's first alias. */
function oneCellSandbox(): AgentSandbox & { queries: string[] } {
  const results = new Map<string, StoredResult>();
  const queries: string[] = [];
  return {
    queries,
    listTables: async () => [{ table: "penguins", rows: 344, columns: 8 }],
    describe: async () => {
      throw new Error("not needed");
    },
    python: async () => ({ error: "not needed", stdout: "" }),
    sql: async (sql) => {
      queries.push(sql);
      const name = sql.match(/\bAS\s+"?(\w+)"?/i)?.[1] ?? "value";
      const id = `r${results.size + 1}`;
      const rows: Cell[][] = [[MEAN]];
      const columns = [{ name, type: "DOUBLE" }];
      results.set(id, { id, columns, rows, truncated: false });
      return {
        result_id: id,
        columns,
        row_count: 1,
        preview: rows,
        truncated: false,
        elapsed_ms: 2,
      };
    },
    getResult: (id) => results.get(id),
  };
}

const catalog = [
  "Table penguins: 344 rows, 8 columns",
  '- species VARCHAR · ~3 distinct · top: "Adelie", "Gentoo", "Chinstrap"',
  "- body_mass_g BIGINT · 0.58% null · 2700 to 6300",
].join("\n");

describe.each(["gemini", "geminiLite", "groq"] as const)("%s", (id) => {
  const provider = PROVIDERS[id];
  it.skipIf(!provider.configured(env))(
    "completes a tool-call round trip to a verified answer",
    async () => {
      const sandbox = oneCellSandbox();
      const res = await runAgent(
        {
          question: "What is the average body mass of all penguins, in grams?",
          catalog,
          settings: { maxSteps: 5 },
        },
        { model: patient(providerClient(provider, env)), sandbox },
      );
      const tools = res.events
        .filter((e) => e.type === "tool")
        .map((e) => e.tool);
      console.log(
        `${id} (${provider.model}): ${res.steps} steps, ${res.usage.input_tokens}+${res.usage.output_tokens} tokens, tools ${tools.join(" → ")}`,
      );
      if (res.outcome.kind !== "answer" || !res.outcome.verified)
        console.log(
          JSON.stringify(res.outcome).slice(0, 500),
          res.events
            .map(
              (e) => `
  ${e.stepId} ${e.type} ${e.tool ?? ""}: ${e.outputPreview.slice(0, 160)}`,
            )
            .join(""),
        );
      expect(sandbox.queries.length).toBeGreaterThan(0);
      expect(res.outcome).toMatchObject({ kind: "answer", verified: true });
    },
  );
});
