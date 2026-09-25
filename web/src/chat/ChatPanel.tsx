import {
  MAX_STEPS_CAP,
  type Outcome,
  type StoredResult,
} from "@browser-analyst/agent";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { Agent, PendingApproval, TurnView } from "../agent/useAgent";
import { formatCount, formatMs } from "../format";
import { FinalAnswer, type ResultSource } from "./FinalAnswer";
import { Code } from "./SqlCode";
import { StepCard } from "./StepCard";

function ApprovalCard({
  request,
  decide,
}: {
  request: PendingApproval;
  decide: (ok: boolean) => void;
}) {
  return (
    <section
      aria-label="Approve Python"
      className="space-y-2 rounded-lg border-2 border-amber-400 p-3 dark:border-amber-700"
    >
      <p className="text-sm font-medium">
        <span aria-hidden="true">⏸ </span>
        The agent wants to run this Python in your browser: {request.purpose}
      </p>
      {request.inputIds.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Inputs as DataFrames: {request.inputIds.join(", ")}
        </p>
      )}
      <Code code={request.code} language="python" />
      <p className="text-xs text-slate-600 dark:text-slate-400">
        It runs in a separate worker in this tab and is stopped after 15 s. Only
        its printed output and a 20-row preview of its result go back to the
        model.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decide(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Run Python
        </button>
        <button
          type="button"
          onClick={() => decide(false)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700"
        >
          Don’t run
        </button>
      </div>
    </section>
  );
}

function Stopped({
  outcome,
}: {
  outcome: Extract<Outcome, { kind: "stopped" }>;
}) {
  const friendly =
    outcome.errorReason === "quota" || outcome.errorReason === "rate_limit";
  return (
    <p
      role={friendly ? "status" : "alert"}
      className={`rounded-md border px-3 py-2 text-sm ${
        friendly
          ? "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
          : "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
      }`}
    >
      <span aria-hidden="true">{friendly ? "ℹ " : "⚠ "}</span>
      {outcome.message}
    </p>
  );
}

function Turn({
  turn,
  live,
  ask,
  getResult,
  sourceFor,
  approval,
  decide,
}: {
  turn: TurnView;
  live: boolean;
  ask: (q: string) => void;
  getResult: (id: string) => StoredResult | undefined;
  sourceFor: (id: string) => ResultSource | undefined;
  approval: PendingApproval | null;
  decide: (ok: boolean) => void;
}) {
  const o = turn.outcome;
  const chartsInAnswer = new Set(
    o?.kind === "answer" ? o.charts.map((c) => c.chart_id) : [],
  );
  return (
    <li className="space-y-3">
      <p className="ml-auto w-fit max-w-[90%] rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
        <span className="sr-only">You asked: </span>
        {turn.question}
      </p>
      {turn.steps.map((s) => (
        <StepCard
          key={s.id}
          step={s}
          getResult={getResult}
          chartsInAnswer={chartsInAnswer}
        />
      ))}
      {approval?.turnId === turn.id && (
        <ApprovalCard request={approval} decide={decide} />
      )}
      {live && !approval && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
          <span aria-hidden="true" className="mr-2 inline-block animate-spin">
            ◌
          </span>
          Working…
        </p>
      )}
      {o?.kind === "answer" && (
        <FinalAnswer
          answer={o.answer}
          checks={o.checks}
          verified={o.verified}
          charts={o.charts}
          getResult={getResult}
          sourceFor={sourceFor}
        />
      )}
      {o?.kind === "ask_user" && (
        <section
          aria-label="Question from the agent"
          className="space-y-2 rounded-lg border-2 border-indigo-200 p-4 dark:border-indigo-900"
        >
          <p className="text-sm font-medium">{o.question}</p>
          {o.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {o.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => ask(opt)}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Or type your reply below.
          </p>
        </section>
      )}
      {o?.kind === "stopped" && <Stopped outcome={o} />}
      {o && turn.usage && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {turn.steps.length} step{turn.steps.length === 1 ? "" : "s"} ·{" "}
          {formatCount(turn.usage.input_tokens)} in /{" "}
          {formatCount(turn.usage.output_tokens)} out tokens
          {turn.durationMs !== undefined && ` · ${formatMs(turn.durationMs)}`}
        </p>
      )}
    </li>
  );
}

export function ChatPanel({
  agent,
  ready,
  suggestions,
  draft,
  getResult,
  onShowPayload,
}: {
  agent: Agent;
  /** At least one table is loaded. */
  ready: boolean;
  suggestions: string[];
  draft: string;
  getResult: (id: string) => StoredResult | undefined;
  onShowPayload: () => void;
}) {
  const [text, setText] = useState(draft);
  useEffect(() => setText(draft), [draft]);

  const sourceFor = useCallback(
    (id: string): ResultSource | undefined => {
      for (const t of agent.turns)
        for (const s of t.steps)
          for (const tool of s.tools) {
            const out = tool.output as { result_id?: string } | null;
            if (!tool.ok || out?.result_id !== id) continue;
            const input = tool.input as { sql?: string; code?: string };
            if (tool.tool === "run_sql")
              return { language: "sql", code: String(input.sql ?? "") };
            if (tool.tool === "run_python")
              return { language: "python", code: String(input.code ?? "") };
          }
      return undefined;
    },
    [agent.turns],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || agent.running || !ready) return;
    void agent.ask(text.trim());
    setText("");
  };

  return (
    <section aria-labelledby="chat-heading" className="flex flex-col gap-4">
      <h2 id="chat-heading" className="text-lg font-semibold">
        Ask the agent
      </h2>
      {agent.turns.length === 0 && suggestions.length > 0 && (
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Try one of these:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setText(q)}
                className="rounded-full border border-slate-300 px-3 py-1 text-left text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      <ol className="space-y-6">
        {agent.turns.map((t, i) => (
          <Turn
            key={t.id}
            turn={t}
            live={agent.running && i === agent.turns.length - 1}
            ask={(q) => void agent.ask(q)}
            getResult={getResult}
            sourceFor={sourceFor}
            approval={agent.pendingApproval}
            decide={agent.decide}
          />
        ))}
      </ol>
      {agent.checkNeeded && (
        <p role="status" className="text-sm">
          Please complete the quick check below to start.
        </p>
      )}
      <div ref={agent.turnstileRef} />
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <textarea
          id="question"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          rows={2}
          maxLength={1000}
          placeholder={
            ready ? "Ask a question about your data…" : "Load a file first…"
          }
          className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="flex flex-wrap items-center gap-3">
          {agent.running ? (
            <button
              type="button"
              onClick={agent.stop}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!ready || !text.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Ask
            </button>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            Max steps
            <select
              value={agent.maxSteps}
              onChange={(e) => agent.setMaxSteps(Number(e.target.value))}
              className="rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
            >
              {Array.from({ length: MAX_STEPS_CAP - 3 }, (_, i) => i + 4).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={agent.approvePython}
              onChange={(e) => agent.setApprovePython(e.target.checked)}
              className="size-4"
            />
            Ask before running Python
          </label>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Sent to the model: table schemas and profiles, previews of at most 20
          rows per query, and this conversation. Your file stays in your
          browser; every query runs here.{" "}
          <button
            type="button"
            onClick={onShowPayload}
            className="font-medium underline underline-offset-2"
          >
            What the model saw
          </button>
        </p>
      </form>
    </section>
  );
}
