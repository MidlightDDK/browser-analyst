// Runs the agent loop in the browser: the model call goes through the gateway,
// every tool call runs in the local sandbox (DuckDB, or Pyodide after the
// user approves).

import {
  type AgentSandbox,
  compactCatalog,
  DEFAULT_MAX_STEPS,
  type Defenses,
  gatewayClient,
  type Outcome,
  type PythonApproval,
  type Replay,
  runAgent,
  type StepRequestBody,
  type StoredResult,
  summarizeAnswer,
  type TraceEvent,
  type TurnSummary,
  type Usage,
} from "@browser-analyst/agent";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LoadedTable } from "../data/useDataSession";
import { ReplayPlayer } from "../replay/player";
import { describeViolation, onCspViolation } from "../security/csp";
import { initialDefenses } from "../security/defenses";
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

export interface PendingApproval extends PythonApproval {
  turnId: number;
}

export interface TurnView {
  id: number;
  question: string;
  steps: StepView[];
  events: TraceEvent[];
  outcome?: Outcome;
  usage?: Usage;
  durationMs?: number;
  /** Set on a played-back recording; its results come with it. */
  replay?: { id: string; provider: string; model: string; recordedAt: string };
  results?: StoredResult[];
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
  const [approvePython, setApprovePython] = useState(true);
  const [defenses, setDefenses] = useState<Defenses>(initialDefenses);
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const settleApproval = useRef<((ok: boolean) => void) | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const nextId = useRef(1);
  const turnStart = useRef(0);
  const cspCount = useRef(0);
  const player = useRef<ReplayPlayer | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replaySpeed, setReplaySpeedState] = useState(1);
  const speedRef = useRef(replaySpeed);

  useEffect(() => () => player.current?.stop(), []);

  // A blocked request shows up in the latest turn's trace, even when it comes
  // after the run (an image in a rendered answer).
  useEffect(
    () =>
      onCspViolation((v) => {
        const text = describeViolation(v);
        const event: TraceEvent = {
          stepId: `csp${++cspCount.current}`,
          type: "security",
          input: v,
          outputPreview: text,
          ok: false,
          durationMs: 0,
          at: Math.round(performance.now() - turnStart.current),
        };
        setTurns((ts) =>
          ts.length
            ? ts.map((t, i) =>
                i === ts.length - 1
                  ? { ...t, events: [...t.events, event] }
                  : t,
              )
            : ts,
        );
      }),
    [],
  );

  /** The user clicked Run (true) or Don't run (false). */
  const decide = useCallback((ok: boolean) => {
    settleApproval.current?.(ok);
    settleApproval.current = null;
    setPendingApproval(null);
  }, []);

  const ask = useCallback(
    async (question: string) => {
      if (abortRef.current || !question.trim()) return;
      player.current?.skip();
      const id = nextId.current++;
      const update = (fn: (t: TurnView) => TurnView) =>
        setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
      // A replay's result ids belong to the recording, not this session.
      const prior = turnsRef.current.flatMap((t) => {
        if (t.replay) return [];
        const s = turnSummary(t);
        return s ? [s] : [];
      });
      setTurns((ts) => [...ts, { id, question, steps: [], events: [] }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(true);
      const t0 = performance.now();
      turnStart.current = t0;
      try {
        const sandbox = await getSandbox();
        // Any bot check happens before the loop, so step timings exclude it.
        const el = turnstileRef.current;
        if (!el) throw new Error("The page isn't ready.");
        await ensureSession(el, setCheckNeeded);
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
            settings: { maxSteps, approvePython, defenses },
          },
          {
            model,
            sandbox,
            signal: ctrl.signal,
            approvePython: (req) =>
              new Promise<boolean>((resolve) => {
                settleApproval.current = resolve;
                setPendingApproval({ ...req, turnId: id });
              }),
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
        decide(false);
        abortRef.current = null;
        setRunning(false);
        setCheckNeeded(false);
      }
    },
    [getSandbox, tables, maxSteps, approvePython, defenses, decide],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    decide(false);
  }, [decide]);

  /** Plays a recorded run as a new turn; no model or sandbox involved. */
  const playReplay = useCallback((r: Replay) => {
    if (abortRef.current) return;
    player.current?.skip();
    const id = nextId.current++;
    const update = (fn: (t: TurnView) => TurnView) =>
      setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
    setTurns((ts) => [
      ...ts,
      {
        id,
        question: r.question,
        steps: [],
        events: [],
        replay: {
          id: r.id,
          provider: r.provider,
          model: r.model,
          recordedAt: r.recorded_at,
        },
        results: r.results,
      },
    ]);
    const p = new ReplayPlayer(
      r.events,
      r.durationMs,
      {
        event: (e) => update((t) => applyEvent(t, e)),
        done: () => {
          update((t) => ({
            ...t,
            outcome: r.outcome,
            usage: r.usage,
            durationMs: r.durationMs,
          }));
          if (player.current === p) {
            player.current = null;
            setReplaying(false);
          }
        },
      },
      speedRef.current,
    );
    player.current = p;
    setReplaying(true);
    p.start();
  }, []);

  const setReplaySpeed = useCallback((speed: number) => {
    speedRef.current = speed;
    setReplaySpeedState(speed);
    player.current?.setSpeed(speed);
  }, []);

  const skipReplay = useCallback(() => player.current?.skip(), []);

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
    approvePython,
    setApprovePython,
    defenses,
    setDefenses,
    pendingApproval,
    decide,
    replaying,
    replaySpeed,
    playReplay,
    setReplaySpeed,
    skipReplay,
  };
}

export type Agent = ReturnType<typeof useAgent>;
