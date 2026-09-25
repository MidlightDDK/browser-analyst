// `pnpm bench:report [--dir <results dir>] [--gate] [--baseline] [--markdown <file>]`
// Prints a markdown report of the newest run (or --dir), per model.
// --gate: exit 1 unless smoke success >= baseline smoke success - 5 points.
// --baseline: record this complete full run as benchmark/baseline.json.
// Complete full runs (--tasks all) also write web/public/benchmark/latest.json.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
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

async function newestRun(): Promise<string> {
  const root = `${BENCH_DIR}results/`;
  const dirs = existsSync(root) ? (await readdir(root)).sort() : [];
  const last = dirs.at(-1);
  if (!last)
    throw new Error("no runs in benchmark/results/: run pnpm bench first");
  return `${root}${last}/`;
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
const published: Summary[] = [];

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

  if (full && s.complete) published.push(s);
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

if (published.length) {
  const judge = existsSync(`${BENCH_DIR}judge.json`)
    ? JSON.parse(await readFile(`${BENCH_DIR}judge.json`, "utf8"))
    : null;
  await mkdir(`${ROOT}web/public/benchmark/`, { recursive: true });
  await writeFile(
    `${ROOT}web/public/benchmark/latest.json`,
    `${JSON.stringify({ generated_at: new Date().toISOString(), models: published, judge }, null, 2)}\n`,
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
