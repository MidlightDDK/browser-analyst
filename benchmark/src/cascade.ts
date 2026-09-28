// `pnpm bench:cascade --run benchmark/results/<ts>/ [--model geminiLite]`: the
// cascade with PocketSQL as tier 0 (packages/agent/src/cascade.ts). The
// released PocketSQL model answers every task first: the q4f16 ONNX files the
// browser would load, through Transformers.js in Node. Tasks it escalates take
// the agent's recorded result from <run>/<model>.jsonl, so no LLM calls are
// made. Writes web/public/benchmark/cascade.json.

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  type Escalation,
  type LocalSqlModel,
  tier0,
  tier0Schema,
} from "@browser-analyst/agent";
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  type Tensor,
} from "@huggingface/transformers";
import { NodeDuckDBSandbox } from "./adapters/duckdb-node.ts";
import { loadDatasets, ROOT, registerDatasets } from "./datasets.ts";
import { scoreTable } from "./score.ts";
import type { Summary, TaskRecord } from "./summary.ts";
import { loadTasks } from "./tasks.ts";

// The release PocketSQL's web app pins (its web/src/config.ts).
const POCKETSQL = "MidlightDDK/pocketsql-0.5b";
const REVISION = "de60f0f6515208c9b24fe9d9d36f56f1dc336506";
const DTYPE = "q4f16";
const DEVICE = "webgpu";
const MAX_NEW_TOKENS = 256;
const SAMPLE_TEMPERATURE = 0.3;
const OUT = `${ROOT}web/public/benchmark/cascade.json`;
// Extra keys reach the Jinja template; enable_thinking is not in the option types.
const TEMPLATE_OPTIONS = {
  add_generation_prompt: true,
  enable_thinking: false,
  return_dict: true,
} as const;

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    model: { type: "string", default: "geminiLite" },
  },
});
if (!values.run) throw new Error("--run benchmark/results/<ts>/");
const runDir = values.run.endsWith("/") ? values.run : `${values.run}/`;
const agentSummary = JSON.parse(
  await readFile(`${runDir}${values.model}.summary.json`, "utf8"),
) as Summary;
const agent = new Map(
  (await readFile(`${runDir}${values.model}.jsonl`, "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as TaskRecord)
    .map((r) => [r.id, r]),
);
if (agentSummary.split !== "all" || !agentSummary.complete)
  throw new Error("needs a complete run of all tasks");

const tokenizer = await AutoTokenizer.from_pretrained(POCKETSQL, {
  revision: REVISION,
});
const llm = await AutoModelForCausalLM.from_pretrained(POCKETSQL, {
  revision: REVISION,
  dtype: DTYPE,
  device: DEVICE,
});
const local: LocalSqlModel = {
  async generate(messages, sample) {
    const inputs = tokenizer.apply_chat_template(
      messages,
      TEMPLATE_OPTIONS,
    ) as unknown as { input_ids: Tensor; attention_mask: Tensor };
    const out = (await llm.generate({
      ...inputs,
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: sample,
      ...(sample ? { temperature: SAMPLE_TEMPERATURE } : {}),
    })) as Tensor;
    const start = inputs.input_ids.dims[1] ?? 0;
    const [text] = tokenizer.batch_decode(
      out.slice(null, [start, out.dims[1] ?? 0]),
      { skip_special_tokens: true },
    );
    return text ?? "";
  },
};

interface CascadeRecord {
  id: string;
  category: string;
  kind: string;
  sql: string;
  sample_sql?: string;
  escalate?: Escalation;
  /** The tier-0 result scored, whether or not it escalated. */
  local_pass: boolean;
  local_ms: number;
  agent_pass: boolean;
  agent_calls: number;
  agent_tokens: number;
}

const datasets = await loadDatasets();
const records: CascadeRecord[] = [];
for (const task of await loadTasks()) {
  const rec = agent.get(task.id);
  if (!rec) throw new Error(`${task.id} is missing from the agent run`);
  const sandbox = await NodeDuckDBSandbox.create();
  try {
    await registerDatasets(sandbox, datasets, task.datasets);
    const schema = await tier0Schema(sandbox);
    const t0 = performance.now();
    const answer = await tier0(task.question, schema, local, sandbox);
    const result = answer.resultId
      ? sandbox.getResult(answer.resultId)
      : undefined;
    records.push({
      id: task.id,
      category: task.category,
      kind: task.expected.kind,
      sql: answer.sql,
      ...(answer.sampleSql !== undefined
        ? { sample_sql: answer.sampleSql }
        : {}),
      ...(answer.escalate ? { escalate: answer.escalate } : {}),
      local_pass: result !== undefined && scoreTable(task, result),
      local_ms: Math.round(performance.now() - t0),
      agent_pass: rec.pass,
      agent_calls: rec.model_calls,
      agent_tokens: rec.tokens_in + rec.tokens_out,
    });
  } finally {
    await sandbox.close();
  }
  const r = records.at(-1) as CascadeRecord;
  console.log(
    `${r.escalate ? `-> ${r.escalate.padEnd(8)}` : "local      "} ${r.local_pass ? "right" : "wrong"}  ${task.id}`,
  );
}
await llm.dispose();

// "valid": keep any local answer that runs and returns rows; "agree": also
// needs the second sample to return the same result.
const RULES = {
  valid: ["chart", "error", "empty"],
  agree: ["chart", "error", "empty", "disagree"],
} satisfies Record<string, Escalation[]>;

const pct = (n: number, d: number) => Math.round((1000 * n) / d) / 10;
function summarize(escalating: readonly Escalation[]) {
  const up = (r: CascadeRecord) =>
    r.escalate !== undefined && escalating.includes(r.escalate);
  const kept = records.filter((r) => !up(r));
  const pass = (r: CascadeRecord) => (up(r) ? r.agent_pass : r.local_pass);
  const sum = (rs: CascadeRecord[], k: "agent_calls" | "agent_tokens") =>
    rs.reduce((s, r) => s + r[k], 0);
  const byCategory: Record<string, { tasks: number; local: number }> = {};
  for (const r of records) {
    const c = byCategory[r.category] ?? { tasks: 0, local: 0 };
    c.tasks++;
    if (!up(r)) c.local++;
    byCategory[r.category] = c;
  }
  return {
    answered_locally: kept.length,
    local_right: kept.filter((r) => r.local_pass).length,
    success: pct(records.filter(pass).length, records.length),
    agent_success: pct(
      records.filter((r) => r.agent_pass).length,
      records.length,
    ),
    llm_calls: sum(records.filter(up), "agent_calls"),
    agent_llm_calls: sum(records, "agent_calls"),
    llm_calls_saved: pct(sum(kept, "agent_calls"), sum(records, "agent_calls")),
    tokens_saved: pct(sum(kept, "agent_tokens"), sum(records, "agent_tokens")),
    by_category: byCategory,
  };
}

const ms = records.map((r) => r.local_ms).sort((a, b) => a - b);
const report = {
  generated_at: new Date().toISOString(),
  tier0: {
    model: POCKETSQL,
    revision: REVISION,
    dtype: DTYPE,
    device: `${DEVICE} (Node.js)`,
    median_ms: ms[Math.floor(ms.length / 2)],
  },
  agent: {
    model: agentSummary.model,
    provider_model: agentSummary.provider_model,
    run: agentSummary.started_at,
  },
  tasks: records.length,
  rules: { valid: summarize(RULES.valid), agree: summarize(RULES.agree) },
  records,
};
await writeFile(OUT, `${JSON.stringify(report, null, 1)}\n`);
for (const [rule, s] of Object.entries(report.rules))
  console.log(
    `${rule}: ${s.answered_locally}/${records.length} local (${s.local_right} right), success ${s.success}% vs ${s.agent_success}% agent alone, LLM calls saved ${s.llm_calls_saved}%`,
  );
console.log(OUT.replace(ROOT, ""));
