// Runs the agent loop in the browser: the model call goes through the gateway,
// every tool call runs in the local DuckDB sandbox.

import {
  type AgentSandbox,
  compactCatalog,
  DEFAULT_MAX_STEPS,
  gatewayClient,
  type Outcome,
  runAgent,
  type StepRequestBody,
  summarizeAnswer,
  type TraceEvent,
  type TurnSummary,
  type Usage,
} from "@browser-analyst/agent";
import { useCallback, useRef, useState } from "react";
import type { LoadedTable } from "../data/useDataSession";
import { ensureSession } from "./session";

export interface ToolView {
  /** "2.1": step 2, first tool call. */
  id: string;
  tool: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  summary: string;
  durationMs: number;
}

export interface StepView {
  id: string;
  text: string;
  provider?: string;
  model?: string;
  tokens?: Usage;
  durationMs?: number;
  tools: ToolView[];
}

export interface TurnView {
  id: number;
  question: string;
  steps: StepView[];
  events: TraceEvent[];
  outcome?: Outcome;
  usage?: Usage;
  durationMs?: number;
}

function turnSummary(t: TurnView): TurnSummary | null {
  const o = t.outcome;
  if (!o) return null;
  const answer =
    o.kind === "answer"
      ? summarizeAnswer(o.answer)
      : o.kind === "ask_user"
        ? `(You asked the user: ${o.question}${o.options.length ? ` Options: ${o.options.join(" / ")}` : ""})`
        : `(No answer: ${o.message})`;
  return { question: t.question, answer };
}

function withStep(
  t: TurnView,
  id: string,
  patch: (s: StepView) => StepView,
): TurnView {
  const exists = t.steps.some((s) => s.id === id);
  return {
    ...t,
    steps: exists
      ? t.steps.map((s) => (s.id === id ? patch(s) : s))
      : [...t.steps, patch({ id, text: "", tools: [] })],
  };
}

function applyEvent(t: TurnView, e: TraceEvent): TurnView {
  const next = { ...t, events: [...t.events, e] };
  if (e.type === "model") {
    const out = e.output as { text?: string } | undefined;
    return withStep(next, e.stepId, (s) => ({
      ...s,
      text: s.text || out?.text || "",
      provider: e.provider,
      model: e.model,
      tokens: e.tokens,
      durationMs: e.durationMs,
    }));
  }
  if (e.type === "tool") {
    const stepId = e.stepId.split(".")[0] ?? e.stepId;
    return withStep(next, stepId, (s) => ({
      ...s,
      tools: [
        ...s.tools,
        {
          id: e.stepId,
          tool: e.tool ?? "?",
          input: e.input,
          output: e.output,
          ok: e.ok ?? false,
          summary: e.outputPreview,
          durationMs: e.durationMs,
        },
      ],
    }));
  }
  return next;
}

export function useAgent({
  tables,
  getSandbox,
}: {
  tables: LoadedTable[];
  getSandbox: () => Promise<AgentSandbox>;
}) {
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [running, setRunning] = useState(false);
  const [lastPayload, setLastPayload] = useState<StepRequestBody | null>(null);
  const [checkNeeded, setCheckNeeded] = useState(false);
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const nextId = useRef(1);

  const ask = useCallback(
    async (question: string) => {
      if (abortRef.current || !question.trim()) return;
      const id = nextId.current++;
      const update = (fn: (t: TurnView) => TurnView) =>
        setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
      const prior = turnsRef.current.flatMap((t) => {
        const s = turnSummary(t);
        return s ? [s] : [];
      });
      setTurns((ts) => [...ts, { id, question, steps: [], events: [] }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(true);
      const t0 = performance.now();
      try {
        const sandbox = await getSandbox();
        const model = gatewayClient({
          ensureSession: (force) => {
            const el = turnstileRef.current;
            if (!el) return Promise.reject(new Error("The page isn't ready."));
            return ensureSession(el, setCheckNeeded, force);
          },
          onRequest: setLastPayload,
        });
        const result = await runAgent(
          {
            question,
            catalog: compactCatalog(
              tables.map((t) => ({ profile: t.profile, source: t.source })),
            ),
            priorTurns: prior,
            settings: { maxSteps },
          },
          {
            model,
            sandbox,
            signal: ctrl.signal,
            onText: (stepId, delta) =>
              update((t) =>
                withStep(t, stepId, (s) => ({ ...s, text: s.text + delta })),
              ),
            onEvent: (e) => update((t) => applyEvent(t, e)),
          },
        );
        update((t) => ({
          ...t,
          outcome: result.outcome,
          usage: result.usage,
          durationMs: Math.round(performance.now() - t0),
        }));
      } catch (err) {
        update((t) => ({
          ...t,
          outcome: {
            kind: "stopped",
            reason: "model_error",
            message: err instanceof Error ? err.message : String(err),
          },
          durationMs: Math.round(performance.now() - t0),
        }));
      } finally {
        abortRef.current = null;
        setRunning(false);
        setCheckNeeded(false);
      }
    },
    [getSandbox, tables, maxSteps],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return {
    turns,
    running,
    ask,
    stop,
    lastPayload,
    checkNeeded,
    turnstileRef,
    maxSteps,
    setMaxSteps,
  };
}

export type Agent = ReturnType<typeof useAgent>;
