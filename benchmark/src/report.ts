// `pnpm bench:report [--dir <results dir>] [--gate] [--baseline] [--markdown <file>]`
// Prints a markdown report of the newest run (or --dir), per model.
// --gate: exit 1 unless smoke success >= baseline smoke success - 5 points.
// --baseline: record this complete full run as benchmark/baseline.json.
// A complete full run (--tasks all) also rewrites web/public/benchmark/latest.json
// from each model's newest complete full run of the current prompt and toolset,
// so models benchmarked on different days share one leaderboard.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PROMPT_VERSION, TOOLSET_VERSION } from "@browser-analyst/agent";
import { BENCH_DIR, ROOT } from "./datasets.ts";
import {
  type Baseline,
  gate,
  type Summary,
  type TaskRecord,
} from "./summary.ts";

const BASELINE = `${BENCH_DIR}baseline.json`;

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    gate: { type: "boolean", default: false },
    baseline: { type: "boolean", default: false },
    markdown: { type: "string" },
  },
});

const RESULTS = `${BENCH_DIR}results/`;

/** Timestamped run directories, oldest first (red-team runs live elsewhere). */
async function runDirs(): Promise<string[]> {
  if (!existsSync(RESULTS)) return [];
  return (await readdir(RESULTS)).filter((d) => /^\d{4}-/.test(d)).sort();
}

async function readRecords(dir: string, model: string): Promise<TaskRecord[]> {
  return (await readFile(`${dir}${model}.jsonl`, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TaskRecord);
}

const LATEST = `${ROOT}web/public/benchmark/latest.json`;
const current = (s: Summary) =>
  s.prompt_version === PROMPT_VERSION && s.toolset_version === TOOLSET_VERSION;

/**
 * Per model, the newest complete full run of the current versions. Models with
 * no such run here (CI only has its own) keep their published entry.
 */
async function leaderboard() {
  const seen = new Map<string, Summary & { failures: unknown[] }>();
  for (const d of (await runDirs()).reverse()) {
    const dir = `${RESULTS}${d}/`;
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".summary.json")) continue;
      const s = JSON.parse(await readFile(`${dir}${f}`, "utf8")) as Summary;
      if (seen.has(s.model) || s.split !== "all" || !s.complete || !current(s))
        continue;
      const failures = (await readRecords(dir, s.model))
        .filter((r) => !r.pass)
        .map((r) => ({
          id: r.id,
          category: r.category,
          tags: r.tags,
          detail: r.detail.slice(0, 200),
        }));
      seen.set(s.model, { ...s, failures });
    }
  }
  if (existsSync(LATEST)) {
    const old = JSON.parse(await readFile(LATEST, "utf8")) as {
      models: (Summary & { failures: unknown[] })[];
    };
    for (const m of old.models)
      if (!seen.has(m.model) && current(m)) seen.set(m.model, m);
  }
  return [...seen.values()].sort(
    (a, b) => b.overall.success - a.overall.success,
  );
}

async function newestRun(): Promise<string> {
  const last = (await runDirs()).at(-1);
  if (!last)
    throw new Error("no runs in benchmark/results/: run pnpm bench first");
  return `${RESULTS}${last}/`;
}

const dir = values.dir
  ? `${values.dir.replace(/[\\/]$/, "")}/`
  : await newestRun();
const files = (await readdir(dir)).filter((f) => f.endsWith(".summary.json"));
if (!files.length) throw new Error(`no summaries in ${dir}`);
const baseline: Baseline | null = existsSync(BASELINE)
  ? JSON.parse(await readFile(BASELINE, "utf8"))
  : null;

const pct = (v: number | null) =>
  v === null ? "n/a" : `${Math.round(v * 1000) / 10}%`;
const out: string[] = [];
let gateFailed = false;
let published = false;

for (const file of files) {
  const s = JSON.parse(await readFile(`${dir}${file}`, "utf8")) as Summary;
  const records = (await readFile(`${dir}${s.model}.jsonl`, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TaskRecord);
  const full = s.split === "all";
  const base = baseline?.model === s.model ? baseline : null;

  out.push(
    `### Benchmark (${s.split}): ${s.model} (\`${s.provider_model}\`)`,
    "",
  );
  let headline = `**${s.overall.passed}/${s.overall.tasks} passed (${s.overall.success}%)**`;
  if (!s.complete) headline += " (incomplete: quota ran out)";
  if (base) {
    const g = gate(s, base);
    const ref = full
      ? `${base.overall.success}%`
      : `${base.smoke.success}% on these tasks`;
    headline += ` · baseline ${ref}`;
    if (!full)
      headline += ` · gate: smoke ≥ ${g.floor}% → ${g.ok ? "pass" : "**FAIL**"}`;
    if (values.gate && !g.ok) gateFailed = true;
  } else if (values.gate) {
    gateFailed = true;
    headline += ` · no baseline for ${s.model}`;
  }
  out.push(headline, "");
  out.push(
    `| Category | Tasks | Passed | Success |${full && base ? " Baseline |" : ""}`,
  );
  out.push(`| --- | ---: | ---: | ---: |${full && base ? " ---: |" : ""}`);
  for (const [cat, t] of Object.entries(s.by_category)) {
    const b = base?.by_category[cat];
    out.push(
      `| ${cat} | ${t.tasks} | ${t.passed} | ${t.success}% |${full && base ? ` ${b ? `${b.success}%` : "n/a"} |` : ""}`,
    );
  }
  const m = s.metrics;
  out.push(
    "",
    `Mean steps ${m.mean_steps} · self-repair ${pct(m.self_repair_rate)} · tool errors ${pct(m.tool_error_rate)} · provenance-valid ${pct(m.provenance_valid_rate)} · tokens ${m.tokens_in.toLocaleString("en-US")} in / ${m.tokens_out.toLocaleString("en-US")} out · cache hits ${pct(m.cache_hit_rate)} · ${s.prompt_version}, ${s.toolset_version}`,
  );
  const fails = records.filter((r) => !r.pass);
  if (fails.length) {
    out.push("", "<details><summary>Failures</summary>", "");
    for (const r of fails)
      out.push(
        `- \`${r.id}\` ${r.detail}${r.tags.length ? ` [${r.tags.join(", ")}]` : ""}`,
      );
    out.push("", "</details>");
  }
  out.push("");

  if (full && s.complete) published = true;
  if (values.baseline) {
    if (!full || !s.complete)
      throw new Error("--baseline needs a complete run of --tasks all");
    const b: Baseline = {
      model: s.model,
      provider_model: s.provider_model,
      prompt_version: s.prompt_version,
      toolset_version: s.toolset_version,
      recorded_at: s.started_at,
      overall: s.overall,
      smoke: s.smoke,
      by_category: s.by_category,
      metrics: s.metrics,
    };
    await writeFile(BASELINE, `${JSON.stringify(b, null, 2)}\n`);
  }
}

if (published) {
  const judge = existsSync(`${BENCH_DIR}judge.json`)
    ? JSON.parse(await readFile(`${BENCH_DIR}judge.json`, "utf8"))
    : null;
  const models = await leaderboard();
  await mkdir(`${ROOT}web/public/benchmark/`, { recursive: true });
  await writeFile(
    LATEST,
    `${JSON.stringify({ generated_at: new Date().toISOString(), models, judge }, null, 2)}\n`,
  );
}

const markdown = out.join("\n");
console.log(markdown);
if (values.markdown) await writeFile(values.markdown, markdown);
if (gateFailed) {
  console.error(
    "Gate failed: smoke success fell more than 5 points below the baseline.",
  );
  process.exit(1);
}
