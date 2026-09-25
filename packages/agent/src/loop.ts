// The agent loop: ask the model for a step, run its tool calls through the
// injected sandbox, feed back compact results, and repeat until final_answer,
// ask_user, the step cap, or repeated failures.

import {
  checkKeyNumbers,
  type FinalAnswer,
  type KeyNumberCheck,
} from "./answer.ts";
import { type ChartRecord, type ChartSpec, checkChart } from "./charts.ts";
import {
  buildMessages,
  jsonContent,
  profileContent,
  pythonResultContent,
  type StepRecord,
  type StepToolRecord,
  sqlResultContent,
  type TurnSummary,
} from "./context.ts";
import {
  type ModelClient,
  ModelError,
  type ModelErrorReason,
  type ModelStepResponse,
} from "./model.ts";
import type { Sandbox } from "./sandbox.ts";
import { ALL_ON, type Defenses } from "./security/defenses.ts";
import {
  detectInjection,
  detectorFlag,
  injectionNote,
  scanAnswer,
} from "./security/detector.ts";
import { protectToolContent, spotlightId } from "./security/spotlight.ts";
import { TOOL_BY_NAME, TOOLS } from "./tools/schemas.ts";
import { validateArgs } from "./tools/validate.ts";
import {
  MAX_TOOL_CALLS_PER_MESSAGE,
  type ToolCall,
  type Usage,
  type WireMessage,
} from "./wire.ts";

export const DEFAULT_MAX_STEPS = 8;
export const MAX_STEPS_CAP = 12;
export const MAX_SAME_TOOL_FAILURES = 3;

export const LAST_STEP_NOTE =
  "This is your last step: call final_answer now with what your results show, and put what is still missing in caveats.";
export const NO_TOOL_NOTE =
  "Continue by calling a tool. To answer, call final_answer and cite every number in key_numbers.";
const NO_TOOL = "(reply without a tool call)";

export type AgentSandbox = Pick<
  Sandbox,
  "listTables" | "describe" | "sql" | "python" | "getResult"
>;

export interface AgentSettings {
  /** Default 8, capped at 12. */
  maxSteps?: number;
  /** Ask deps.approvePython before each run_python (declined without it). */
  approvePython?: boolean;
  /** All on by default; the red-team suite turns them off to measure them. */
  defenses?: Partial<Defenses>;
}

export interface PythonApproval {
  /** The tool call's trace id, e.g. "2.1". */
  stepId: string;
  code: string;
  purpose: string;
  inputIds: string[];
}

export interface RunInput {
  question: string;
  /** compactCatalog() of the loaded tables. */
  catalog: string;
  priorTurns?: readonly TurnSummary[];
  settings?: AgentSettings;
}

export interface TraceEvent {
  /** "3" for step 3's model call, "3.1" for its first tool call. */
  stepId: string;
  type: "model" | "tool" | "answer" | "ask_user" | "stop" | "security";
  tool?: string;
  input: unknown;
  /** Full output for the UI (the model saw the compact form). */
  output?: unknown;
  outputPreview: string;
  ok?: boolean;
  durationMs: number;
  /** ms since the run started, so replays keep the original timing. */
  at: number;
  tokens?: Usage;
  provider?: string;
  model?: string;
  securityFlags?: string[];
}

export type StopReason =
  | "step_cap"
  | "repeated_failure"
  | "model_error"
  | "aborted";

export type Outcome =
  | {
      kind: "answer";
      answer: FinalAnswer;
      checks: KeyNumberCheck[];
      /** False when accepted after a second failed validation (shown as a warning). */
      verified: boolean;
      /** The charts listed in chart_ids, in order. */
      charts: ChartRecord[];
    }
  | { kind: "ask_user"; question: string; options: string[] }
  | {
      kind: "stopped";
      reason: StopReason;
      message: string;
      errorReason?: ModelErrorReason;
    };

export interface RunResult {
  outcome: Outcome;
  steps: number;
  usage: Usage;
  events: TraceEvent[];
}

export interface RunDeps {
  model: ModelClient;
  sandbox: AgentSandbox;
  onEvent?: (event: TraceEvent) => void;
  /** Streamed model text per step. */
  onText?: (stepId: string, delta: string) => void;
  /** Resolves true when the user clicks Run (asked only when approvePython is on). */
  approvePython?: (req: PythonApproval) => Promise<boolean>;
  signal?: AbortSignal;
  now?: () => number;
  /** The spotlight block id; random per run unless a test fixes it. */
  spotlightId?: string;
}

interface ToolRun {
  ok: boolean;
  content: string;
  summary: string;
  input: unknown;
  output: unknown;
  outcome?: Outcome;
  /** Time spent waiting for the user, left out of the tool's duration. */
  waitedMs?: number;
}

const errorRun = (input: unknown, message: string): ToolRun => ({
  ok: false,
  content: jsonContent({ error: message }),
  summary: `error: ${message.slice(0, 120)}`,
  input,
  output: { error: message },
});

const isAbort = (err: unknown) =>
  (err instanceof ModelError && err.reason === "aborted") ||
  (err instanceof Error && err.name === "AbortError");

export async function runAgent(
  input: RunInput,
  deps: RunDeps,
): Promise<RunResult> {
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const maxSteps = Math.min(
    MAX_STEPS_CAP,
    Math.max(1, Math.floor(input.settings?.maxSteps ?? DEFAULT_MAX_STEPS)),
  );
  const steps: StepRecord[] = [];
  const events: TraceEvent[] = [];
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const streak = new Map<string, number>();
  const lastError = new Map<string, string>();
  let rejectedAnswers = 0;
  const charts = new Map<string, ChartRecord>();
  const defenses = { ...ALL_ON, ...input.settings?.defenses };
  const dataId = defenses.spotlight
    ? (deps.spotlightId ?? spotlightId())
    : undefined;

  const emit = (e: Omit<TraceEvent, "at">) => {
    const event = { ...e, at: Math.round(now() - t0) };
    events.push(event);
    deps.onEvent?.(event);
  };
  const finish = (outcome: Outcome, stepId: string): RunResult => {
    if (outcome.kind === "stopped")
      emit({
        stepId,
        type: "stop",
        input: { reason: outcome.reason },
        outputPreview: outcome.message,
        ok: false,
        durationMs: 0,
      });
    return { outcome, steps: steps.length, usage, events };
  };
  const stop = (
    reason: StopReason,
    message: string,
    stepId: string,
    errorReason?: ModelErrorReason,
  ) => finish({ kind: "stopped", reason, message, errorReason }, stepId);

  const callModel = async (
    messages: WireMessage[],
    stepId: string,
  ): Promise<ModelStepResponse> => {
    const req = {
      messages,
      signal: deps.signal,
      onText: (d: string) => deps.onText?.(stepId, d),
    };
    try {
      return await deps.model.step(req);
    } catch (err) {
      // One retry for transient failures; everything else is final.
      if (
        err instanceof ModelError &&
        (err.reason === "upstream" || err.reason === "network") &&
        !deps.signal?.aborted
      )
        return deps.model.step(req);
      throw err;
    }
  };

  const runTool = async (
    call: ToolCall,
    callId: string,
    lastStep: boolean,
  ): Promise<ToolRun> => {
    const def = TOOL_BY_NAME.get(call.name);
    if (!def)
      return errorRun(
        call.arguments,
        `Unknown tool "${call.name}". Available tools: ${TOOLS.map((t) => t.name).join(", ")}.`,
      );
    let args: Record<string, unknown>;
    try {
      args = call.arguments.trim()
        ? (JSON.parse(call.arguments) as Record<string, unknown>)
        : {};
    } catch (err) {
      return errorRun(
        call.arguments,
        `The arguments for ${call.name} are not valid JSON (${err instanceof Error ? err.message : String(err)}). Send one JSON object that matches the tool's schema.`,
      );
    }
    const problem = validateArgs(def.parameters, args);
    if (problem)
      return errorRun(args, `Invalid arguments for ${call.name}: ${problem}.`);

    switch (def.name) {
      case "list_tables": {
        const tables = await deps.sandbox.listTables();
        return {
          ok: true,
          content: jsonContent({ tables }),
          summary: `${tables.length} table(s)`,
          input: args,
          output: { tables },
        };
      }
      case "describe_table": {
        const table = String(args.table);
        try {
          const profile = await deps.sandbox.describe(table);
          return {
            ok: true,
            content: profileContent(profile),
            summary: `${table}: ${profile.columns.length} columns`,
            input: args,
            output: profile,
          };
        } catch {
          const names = (await deps.sandbox.listTables()).map((t) => t.table);
          return errorRun(
            args,
            `Unknown table "${table}". Loaded tables: ${names.join(", ") || "none"}.`,
          );
        }
      }
      case "run_sql": {
        const result = await deps.sandbox.sql(
          String(args.sql),
          defenses.sqlGuard ? undefined : { guard: false },
        );
        if ("error" in result) return errorRun(args, result.error);
        const cols = result.columns.map((c) => c.name);
        return {
          ok: true,
          content: sqlResultContent(result),
          summary: `${result.row_count} row(s) (${result.result_id}) [${cols.slice(0, 8).join(", ")}${cols.length > 8 ? ", …" : ""}]: ${String(args.purpose).slice(0, 80)}`,
          input: args,
          output: result,
        };
      }
      case "run_python": {
        const code = String(args.code);
        const inputIds = (args.input_result_ids as unknown[]).map(String);
        let waitedMs: number | undefined;
        if (input.settings?.approvePython) {
          const asked = now();
          const approved =
            (await deps.approvePython?.({
              stepId: callId,
              code,
              purpose: String(args.purpose),
              inputIds,
            })) ?? false;
          waitedMs = now() - asked;
          if (!approved)
            return {
              ...errorRun(
                args,
                "The user declined to run this Python code. Continue with SQL, or answer with what you have.",
              ),
              waitedMs,
            };
        }
        const result = await deps.sandbox.python(code, inputIds);
        if ("error" in result)
          return {
            ok: false,
            content: jsonContent(result),
            summary: `error: ${result.error.slice(0, 120)}`,
            input: args,
            output: result,
            waitedMs,
          };
        const cols = (result.columns ?? []).map((c) => c.name);
        const table = result.result_id
          ? `${result.row_count} row(s) (${result.result_id}) [${cols.slice(0, 8).join(", ")}${cols.length > 8 ? ", …" : ""}]`
          : "printed output only";
        return {
          ok: true,
          content: pythonResultContent(result),
          summary: `${table}: ${String(args.purpose).slice(0, 80)}`,
          input: args,
          output: result,
          waitedMs,
        };
      }
      case "make_chart": {
        const resultId = String(args.result_id);
        const result = deps.sandbox.getResult(resultId);
        if (!result)
          return errorRun(
            args,
            `Unknown result "${resultId}". Chart a result_id returned by run_sql or run_python.`,
          );
        const checked = checkChart(
          args.spec as unknown as ChartSpec,
          resultId,
          result.columns,
          result.rows.length,
        );
        if ("error" in checked) return errorRun(args, checked.error);
        const chart: ChartRecord = {
          chart_id: `c${charts.size + 1}`,
          result_id: resultId,
          spec: checked.spec,
          rows: result.rows.length,
        };
        charts.set(chart.chart_id, chart);
        return {
          ok: true,
          content: jsonContent({
            chart_id: chart.chart_id,
            rows_plotted: chart.rows,
            note: "Drawn in the user's browser from the stored rows, which were not sent to you.",
          }),
          summary: `chart ${chart.chart_id} (${chart.spec.mark} of ${resultId})`,
          input: args,
          output: chart,
        };
      }
      case "ask_user": {
        const question = String(args.question);
        const options = Array.isArray(args.options)
          ? args.options.map(String)
          : [];
        return {
          ok: true,
          content: jsonContent({ status: "asked the user" }),
          summary: "asked the user",
          input: args,
          output: { question, options },
          outcome: { kind: "ask_user", question, options },
        };
      }
      case "final_answer": {
        const answer = args as unknown as FinalAnswer;
        const checks = checkKeyNumbers(answer, (id) =>
          deps.sandbox.getResult(id),
        );
        const cited = answer.chart_ids ?? [];
        const unknownCharts = cited.filter((id) => !charts.has(id));
        const problems = checks.flatMap((c) => (c.problem ? [c.problem] : []));
        if (unknownCharts.length)
          problems.push(
            `chart_ids cites ${unknownCharts.join(", ")}, which no make_chart call for this question created (${charts.size ? `created: ${[...charts.keys()].join(", ")}` : "none yet"}).`,
          );
        if (problems.length === 0 || rejectedAnswers > 0 || lastStep) {
          const shown = cited.flatMap((id) => {
            const c = charts.get(id);
            return c ? [c] : [];
          });
          return {
            ok: true,
            content: jsonContent({ status: "accepted" }),
            summary: "accepted",
            input: args,
            output: checks,
            outcome: {
              kind: "answer",
              answer,
              checks,
              verified: problems.length === 0,
              charts: shown,
            },
          };
        }
        rejectedAnswers++;
        const message = `The answer was not accepted: ${problems.length} key number(s) or chart id(s) don't match what they cite.`;
        return {
          ok: false,
          content: jsonContent({
            error: message,
            problems,
            hint: "Fix each value (or cite the right result, column, and row), computing it in SQL first if needed, then call final_answer again.",
          }),
          summary: `rejected: ${problems.length} key number(s) didn't match`,
          input: args,
          output: { error: message, problems, checks },
        };
      }
    }
  };

  const catalogSignals = defenses.detector
    ? detectInjection(input.catalog)
    : [];
  if (catalogSignals.length)
    emit({
      stepId: "0",
      type: "security",
      input: { source: "catalog", signals: catalogSignals },
      outputPreview: "The injection detector flagged the table catalog",
      ok: false,
      durationMs: 0,
      securityFlags: [detectorFlag("catalog", catalogSignals)],
    });
  const catalogNote = catalogSignals.length
    ? injectionNote(catalogSignals)
    : undefined;

  for (let n = 1; n <= maxSteps; n++) {
    const stepId = String(n);
    if (deps.signal?.aborted) return stop("aborted", "Stopped.", stepId);
    const lastStep = n === maxSteps;
    const messages = buildMessages({
      catalog: input.catalog,
      question: input.question,
      priorTurns: input.priorTurns,
      steps,
      finalNote: lastStep ? LAST_STEP_NOTE : undefined,
      spotlightId: dataId,
      catalogNote,
    });

    const started = now();
    let res: ModelStepResponse;
    try {
      res = await callModel(messages, stepId);
    } catch (err) {
      if (isAbort(err) || deps.signal?.aborted)
        return stop("aborted", "Stopped.", stepId);
      const reason = err instanceof ModelError ? err.reason : "network";
      return stop(
        "model_error",
        err instanceof Error ? err.message : String(err),
        stepId,
        reason,
      );
    }
    if (res.usage) {
      usage.input_tokens += res.usage.input_tokens;
      usage.output_tokens += res.usage.output_tokens;
    }
    emit({
      stepId,
      type: "model",
      input: { messages },
      output: { text: res.text, toolCalls: res.toolCalls },
      outputPreview: res.toolCalls.length
        ? res.toolCalls.map((c) => c.name).join(", ")
        : res.text.slice(0, 200),
      ok: true,
      durationMs: Math.round(now() - started),
      tokens: res.usage ?? undefined,
      provider: res.provider,
      model: res.model,
    });

    const record: StepRecord = { index: n, text: res.text, calls: [] };
    steps.push(record);

    if (res.toolCalls.length === 0) {
      const count = (streak.get(NO_TOOL) ?? 0) + 1;
      streak.set(NO_TOOL, count);
      record.note = NO_TOOL_NOTE;
      if (count >= MAX_SAME_TOOL_FAILURES)
        return stop(
          "repeated_failure",
          `I stopped because the model replied ${count} times without using its tools. Its last reply: ${res.text.slice(0, 300)}`,
          stepId,
        );
      continue;
    }
    streak.delete(NO_TOOL);

    const seen = new Set(steps.flatMap((s) => s.calls.map((c) => c.call.id)));
    let outcome: Outcome | undefined;
    for (const [i, raw] of res.toolCalls.entries()) {
      const callId = `${stepId}.${i + 1}`;
      // Unique ids, so every tool message pairs with its call.
      const id = raw.id && !seen.has(raw.id) ? raw.id : `call_${n}_${i + 1}`;
      seen.add(id);
      const call = { ...raw, id };
      const toolStart = now();
      const run: ToolRun =
        i >= MAX_TOOL_CALLS_PER_MESSAGE
          ? errorRun(
              call.arguments,
              `Skipped: at most ${MAX_TOOL_CALLS_PER_MESSAGE} tool calls per step.`,
            )
          : outcome
            ? {
                ok: true,
                content: jsonContent({ status: "skipped: the turn ended" }),
                summary: "skipped",
                input: call.arguments,
                output: null,
              }
            : await runTool(call, callId, lastStep);
      const signals = defenses.detector ? detectInjection(run.content) : [];
      const entry: StepToolRecord = {
        call,
        content: protectToolContent(run.content, {
          spotlightId: dataId,
          signals,
        }),
        summary: run.summary,
        ok: run.ok,
      };
      record.calls.push(entry);
      if (run.ok) streak.delete(call.name);
      else {
        streak.set(call.name, (streak.get(call.name) ?? 0) + 1);
        lastError.set(call.name, run.summary);
      }
      emit({
        stepId: callId,
        type: "tool",
        tool: call.name,
        input: run.input,
        output: run.output,
        outputPreview: run.summary,
        ok: run.ok,
        durationMs: Math.round(now() - toolStart - (run.waitedMs ?? 0)),
        securityFlags: signals.length
          ? [detectorFlag("tool output", signals)]
          : undefined,
      });
      if (run.outcome && !outcome) outcome = run.outcome;
    }

    if (outcome) {
      const answerSignals =
        outcome.kind === "answer"
          ? scanAnswer(outcome.answer.answer_markdown)
          : [];
      emit({
        stepId,
        type: outcome.kind === "answer" ? "answer" : "ask_user",
        input: outcome.kind === "answer" ? outcome.answer : outcome,
        output: outcome.kind === "answer" ? outcome.checks : undefined,
        outputPreview:
          outcome.kind === "answer"
            ? outcome.verified
              ? "answer: every key number matches its cell"
              : "answer accepted with unverified key numbers"
            : `asked: ${outcome.kind === "ask_user" ? outcome.question : ""}`,
        ok: outcome.kind !== "answer" || outcome.verified,
        durationMs: 0,
        securityFlags: answerSignals.length
          ? [`answer contains ${answerSignals.join(", ")} (never rendered)`]
          : undefined,
      });
      return finish(outcome, stepId);
    }

    for (const [tool, count] of streak)
      if (count >= MAX_SAME_TOOL_FAILURES)
        return stop(
          "repeated_failure",
          `I stopped because ${tool} failed ${count} times in a row. Last ${lastError.get(tool) ?? "error"}`,
          stepId,
        );
  }

  return stop(
    "step_cap",
    `I reached the ${maxSteps}-step limit before finishing. The steps above show what I found so far.`,
    String(maxSteps),
  );
}
