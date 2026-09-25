// The LLM half of refusal scoring: does an answer decline because the data
// can't answer? Gemini Flash-Lite at temperature 0, cached like agent steps.
// `pnpm bench:judge` measures the judge and the rule against 30 hand-labeled
// answers (benchmark/judge-cases.jsonl) and writes benchmark/judge.json.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { GEMINI_LITE } from "../../worker/src/providers/providers.config.ts";
import { BENCH_DIR } from "./datasets.ts";
import { CACHE_DIR } from "./models.ts";
import { saysCannotAnswer } from "./score.ts";

const JUDGE_PROMPT = `You grade answers from a data-analysis assistant. The user asked a question about a dataset. Decide whether the answer DECLINES: it says the dataset cannot answer the question (the needed column, period, or entity is missing), possibly offering related information instead. An answer that gives the requested figure, even with caveats or an assumption, does not decline. Reply with exactly one word: DECLINES or ANSWERS.`;

export const JUDGE_MODEL = GEMINI_LITE.model;

export async function judgeDeclines(
  question: string,
  answer: string,
  apiKey: string | undefined,
): Promise<boolean | null> {
  const body = {
    model: GEMINI_LITE.model,
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      {
        role: "user",
        content: `Question: ${question}\n\nAnswer:\n${answer.slice(0, 4000)}`,
      },
    ],
    temperature: 0,
    max_tokens: 400,
    reasoning_effort: "low",
  };
  const key = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const path = `${CACHE_DIR}judge/${key}.json`;
  let text: string;
  if (existsSync(path)) text = JSON.parse(await readFile(path, "utf8")).text;
  else {
    if (!apiKey) return null;
    let res: Response | undefined;
    for (let attempt = 1; attempt <= 4; attempt++) {
      res = await fetch(GEMINI_LITE.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.ok || ![429, 500, 503].includes(res.status)) break;
      await new Promise((r) => setTimeout(r, 10_000 * attempt));
    }
    if (!res?.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    text = json.choices?.[0]?.message?.content ?? "";
    await mkdir(`${CACHE_DIR}judge/`, { recursive: true });
    await writeFile(path, JSON.stringify({ text }));
  }
  const word = /\b(DECLINES|ANSWERS)\b/.exec(text.toUpperCase())?.[1];
  return word ? word === "DECLINES" : null;
}

interface LabeledCase {
  id: string;
  question: string;
  answer: string;
  label: "declines" | "answers";
}

async function calibrate(): Promise<void> {
  const cases = (await readFile(`${BENCH_DIR}judge-cases.jsonl`, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LabeledCase);
  let judgeRight = 0;
  let ruleRight = 0;
  let agree = 0;
  const misses: string[] = [];
  for (const c of cases) {
    const judge = await judgeDeclines(
      c.question,
      c.answer,
      process.env.GEMINI_API_KEY,
    );
    if (judge === null)
      throw new Error(`judge unavailable for ${c.id} (key or quota)`);
    const rule = saysCannotAnswer(c.answer);
    const truth = c.label === "declines";
    if (judge === truth) judgeRight++;
    else misses.push(`judge:${c.id}`);
    if (rule === truth) ruleRight++;
    else misses.push(`rule:${c.id}`);
    if (judge === rule) agree++;
  }
  const n = cases.length;
  const report = {
    model: JUDGE_MODEL,
    cases: n,
    judge_accuracy: judgeRight / n,
    rule_accuracy: ruleRight / n,
    judge_rule_agreement: agree / n,
    misses,
  };
  await writeFile(
    `${BENCH_DIR}judge.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("benchmark/src/judge.ts"))
  await calibrate();
