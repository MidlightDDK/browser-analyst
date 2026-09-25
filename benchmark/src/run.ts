// `pnpm bench --model <id> --tasks smoke|all|<ids or categories>`: runs the
// production agent loop (packages/agent) on each task with the Node sandbox
// twins, scores it, and writes benchmark/results/<ts>/<model>.jsonl, a summary
// JSON, and one trace per task. Model calls are cached (benchmark/.cache/),
// so a rerun is free and a run cut short by a quota resumes where it stopped.

import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  PROMPT_VERSION,
  runAgent,
  TOOLSET_VERSION,
} from "@browser-analyst/agent";
import { NodeDuckDBSandbox } from "./adapters/duckdb-node.ts";
import {
  BENCH_DIR,
  DATA_DIR,
  loadDatasets,
  registerDatasets,
} from "./datasets.ts";
import { judgeDeclines } from "./judge.ts";
import { benchClient, type ClientStats, MODELS } from "./models.ts";
import { saysCannotAnswer, scoreRun, toolEvents } from "./score.ts";
import { summarize, type TaskRecord } from "./summary.ts";
import { loadTasks, selectTasks } from "./tasks.ts";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "geminiLite" },
    tasks: { type: "string", default: "smoke" },
    /** Per-task limit in seconds, rate-limit backoff included. */
    timeout: { type: "string", default: "600" },
    out: { type: "string" },
    "no-cache": { type: "boolean", default: false },
  },
});
const model = values.model;
const entry = MODELS[model];
if (!entry)
  throw new Error(
    `unknown model ${model}; one of ${Object.keys(MODELS).join(", ")}`,
  );

const datasets = await loadDatasets();
const tasks = selectTasks(await loadTasks(), values.tasks);
for (const name of new Set(tasks.flatMap((t) => t.datasets))) {
  const file = datasets.find((d) => d.name === name)?.file;
  if (!file || !existsSync(`${DATA_DIR}${file}`))
    throw new Error(
      `benchmark/data/${file ?? name} is missing: run pnpm bench:data`,
    );
}

const startedAt = new Date().toISOString();
const outDir =
  values.out ?? `${BENCH_DIR}results/${startedAt.replaceAll(/[:.]/g, "-")}/`;
await mkdir(`${outDir}traces/${model}/`, { recursive: true });
const jsonl = `${outDir}${model}.jsonl`;
await writeFile(jsonl, "");

const stats: ClientStats = { calls: 0, cacheHits: 0 };
const client = benchClient(model, process.env, stats, {
  cache: !values["no-cache"],
});
const timeoutMs = Number(values.timeout) * 1000;
const records: TaskRecord[] = [];
let complete = true;

for (const task of tasks) {
  const before = { ...stats };
  const sandbox = await NodeDuckDBSandbox.create();
  let record: TaskRecord;
  try {
    const catalog = await registerDatasets(sandbox, datasets, task.datasets);
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const t0 = performance.now();
    const result = await runAgent(
      { question: task.question, catalog, settings: { approvePython: false } },
      { model: client, sandbox, signal: ctrl.signal },
    ).finally(() => clearTimeout(timer));
    const wall = performance.now() - t0;
    const { outcome } = result;

    let refusal: TaskRecord["refusal"];
    if (task.expected.kind === "refuse" && outcome.kind === "answer") {
      const text = outcome.answer.answer_markdown;
      refusal = {
        rule: saysCannotAnswer(text),
        judge: await judgeDeclines(
          task.question,
          text,
          process.env.GEMINI_API_KEY,
        ),
      };
    }
    const score = scoreRun(
      task,
      { result, lookup: (id) => sandbox.getResult(id), timedOut },
      refusal ? (refusal.judge ?? refusal.rule) : undefined,
    );
    const tools = toolEvents(result);
    record = {
      id: task.id,
      category: task.category,
      kind: task.expected.kind,
      smoke: task.smoke === true,
      pass: score.pass,
      detail: score.detail,
      tags: score.tags,
      outcome: outcome.kind,
      ...(outcome.kind === "stopped"
        ? {
            stop_reason: outcome.errorReason ?? outcome.reason,
            error: outcome.message.slice(0, 300),
          }
        : {}),
      steps: result.steps,
      tool_calls: tools.length,
      tool_errors: tools.filter((t) => !t.ok).length,
      ...(outcome.kind === "answer" ? { verified: outcome.verified } : {}),
      tokens_in: result.usage.input_tokens,
      tokens_out: result.usage.output_tokens,
      wall_ms: Math.round(wall),
      model_calls: stats.calls - before.calls,
      cache_hits: stats.cacheHits - before.cacheHits,
      ...(refusal ? { refusal } : {}),
      ...(outcome.kind === "answer"
        ? { answer: outcome.answer.answer_markdown.slice(0, 2000) }
        : outcome.kind === "ask_user"
          ? { answer: outcome.question }
          : {}),
    };
    await writeFile(
      `${outDir}traces/${model}/${task.id}.json`,
      JSON.stringify(result.events),
    );
  } finally {
    await sandbox.close();
  }
  records.push(record);
  await appendFile(jsonl, `${JSON.stringify(record)}\n`);
  const mark = record.pass ? "pass" : "FAIL";
  console.log(
    `${mark} ${task.id.padEnd(8)} ${record.steps} steps, ${record.cache_hits}/${record.model_calls} cached, ${(record.wall_ms / 1000).toFixed(1)} s  ${record.pass ? "" : `${record.detail}${record.tags.length ? ` [${record.tags.join(", ")}]` : ""}`}`,
  );
  if (record.stop_reason === "quota") {
    complete = false;
    console.error(
      "Stopped: the provider's quota is used up. Rerun later; cached steps replay for free.",
    );
    break;
  }
}

const summary = summarize(records, {
  model,
  provider_model: entry.provider.model,
  split: values.tasks,
  prompt_version: PROMPT_VERSION,
  toolset_version: TOOLSET_VERSION,
  started_at: startedAt,
  complete,
});
await writeFile(
  `${outDir}${model}.summary.json`,
  `${JSON.stringify(summary, null, 2)}\n`,
);
const m = summary.metrics;
console.log(
  `\n${model}: ${summary.overall.passed}/${summary.overall.tasks} passed (${summary.overall.success}%), ${m.mean_steps} steps/task, cache hits ${Math.round(m.cache_hit_rate * 100)}%\n${outDir}`,
);
if (!complete) process.exit(2);
