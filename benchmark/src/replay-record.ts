// `pnpm replay:record --task <sample>-<n>|all [--model geminiLite] [--allow-fail]`:
// runs the production agent loop (packages/agent, Node sandbox twins) on a
// sample card's question with a live model call per step (no cache and no rate
// limiter, so the timing is real) and writes web/public/replays/<id>.json for
// the UI's replay player. A run that ends without a verified answer is not
// written unless --allow-fail.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  capResult,
  compactCatalog,
  PROMPT_VERSION,
  REPLAY_VERSION,
  type Replay,
  replayResultIds,
  runAgent,
  type StoredResult,
  TOOLSET_VERSION,
} from "@browser-analyst/agent";
import { replayIdFor, SAMPLES } from "../../web/src/samples.ts";
import { NodeDuckDBSandbox } from "./adapters/duckdb-node.ts";
import { ROOT } from "./datasets.ts";
import { benchClient, type ClientStats, MODELS } from "./models.ts";

const { values } = parseArgs({
  options: {
    task: { type: "string", default: "" },
    model: { type: "string", default: "geminiLite" },
    "allow-fail": { type: "boolean", default: false },
  },
});

const all = SAMPLES.flatMap((sample) =>
  sample.questions.map((question) => ({
    id: replayIdFor(question) ?? "",
    sample,
    question,
  })),
);
const wanted =
  values.task === "all" ? all : all.filter((t) => t.id === values.task);
if (!wanted.length)
  throw new Error(`--task is all or one of ${all.map((t) => t.id).join(", ")}`);
const entry = MODELS[values.model];
if (!entry)
  throw new Error(
    `unknown model ${values.model}; one of ${Object.keys(MODELS).join(", ")}`,
  );

const OUT = `${ROOT}web/public/replays/`;
await mkdir(OUT, { recursive: true });
const stats: ClientStats = { calls: 0, cacheHits: 0 };
const client = benchClient(values.model, process.env, stats, {
  cache: false,
  limit: false,
});

for (const t of wanted) {
  const sandbox = await NodeDuckDBSandbox.create();
  try {
    const bytes = new Uint8Array(
      await readFile(`${ROOT}web/public/samples/${t.sample.file}`),
    );
    // The catalog the browser builds for the same file (App → useAgent).
    const tables = [];
    for (const reg of await sandbox.registerFile(t.sample.file, bytes))
      tables.push({
        profile: await sandbox.describe(reg.table),
        source: reg.source,
      });
    const recordedAt = new Date().toISOString();
    const t0 = performance.now();
    const result = await runAgent(
      {
        question: t.question,
        catalog: compactCatalog(tables),
        settings: { approvePython: false },
      },
      { model: client, sandbox },
    );
    const durationMs = Math.round(performance.now() - t0);
    const { outcome } = result;
    const ok = outcome.kind === "answer" && outcome.verified;
    const status =
      outcome.kind === "answer"
        ? `answer${outcome.verified ? "" : " (unverified)"}`
        : outcome.kind === "stopped"
          ? `stopped: ${outcome.message.slice(0, 120)}`
          : outcome.kind;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${t.id.padEnd(16)} ${result.steps} steps, ${(durationMs / 1000).toFixed(1)} s, ${status}`,
    );
    if (!ok && !values["allow-fail"]) {
      process.exitCode = 1;
      continue;
    }
    const results = replayResultIds(result.events)
      .map((id) => sandbox.getResult(id))
      .filter((r): r is StoredResult => r !== undefined)
      .map(capResult);
    const replay: Replay = {
      version: REPLAY_VERSION,
      id: t.id,
      sample: t.sample.id,
      question: t.question,
      provider: entry.provider.id,
      model: entry.provider.model,
      recorded_at: recordedAt,
      prompt_version: PROMPT_VERSION,
      toolset_version: TOOLSET_VERSION,
      events: result.events,
      outcome,
      usage: result.usage,
      durationMs,
      results,
    };
    await writeFile(`${OUT}${t.id}.json`, `${JSON.stringify(replay)}\n`);
  } finally {
    await sandbox.close();
  }
}
