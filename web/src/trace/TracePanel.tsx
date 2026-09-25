import type { TraceEvent } from "@browser-analyst/agent";
import type { TurnView } from "../agent/useAgent";
import { formatCount, formatMs } from "../format";

const LABEL: Record<TraceEvent["type"], string> = {
  model: "Model",
  tool: "Tool",
  answer: "Answer",
  ask_user: "Question",
  stop: "Stopped",
};

function Row({ e }: { e: TraceEvent }) {
  const failed = e.ok === false;
  const detail =
    e.type === "model"
      ? `${e.model ?? e.provider ?? ""}${e.outputPreview ? ` → ${e.outputPreview}` : ""}`
      : e.type === "tool"
        ? `${e.tool}: ${e.outputPreview}`
        : e.outputPreview;
  return (
    <li className="grid grid-cols-[3.5rem_1fr] gap-2 py-1.5 text-xs">
      <span className="text-right font-mono text-slate-500 dark:text-slate-400">
        +{formatMs(e.at)}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={`font-semibold ${failed ? "text-red-800 dark:text-red-300" : ""}`}
          >
            <span aria-hidden="true">{failed ? "✕ " : "✓ "}</span>
            <span className="sr-only">{failed ? "Failed: " : ""}</span>
            {LABEL[e.type]} {e.stepId}
          </span>
          {e.durationMs > 0 && (
            <span className="text-slate-500 dark:text-slate-400">
              {formatMs(e.durationMs)}
            </span>
          )}
          {e.tokens && (
            <span className="text-slate-500 dark:text-slate-400">
              {formatCount(e.tokens.input_tokens)}→
              {formatCount(e.tokens.output_tokens)} tok
            </span>
          )}
        </p>
        <p
          className="truncate text-slate-700 dark:text-slate-300"
          title={detail}
        >
          {detail}
        </p>
        {e.securityFlags?.map((f) => (
          <p key={f} className="text-amber-800 dark:text-amber-300">
            <span aria-hidden="true">⚑ </span>
            {f}
          </p>
        ))}
      </div>
    </li>
  );
}

export function TracePanel({ turns }: { turns: TurnView[] }) {
  return (
    <section aria-labelledby="trace-heading" className="space-y-3">
      <h2 id="trace-heading" className="text-lg font-semibold">
        Trace
      </h2>
      {turns.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Every model call and tool run shows up here with its timing, tokens,
          and provider.
        </p>
      ) : (
        turns.map((t) => (
          <div key={t.id}>
            <h3 className="truncate text-sm font-medium" title={t.question}>
              {t.question}
            </h3>
            {t.usage && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t.steps.length} steps · {formatCount(t.usage.input_tokens)} in
                / {formatCount(t.usage.output_tokens)} out tokens
                {t.durationMs !== undefined && ` · ${formatMs(t.durationMs)}`}
              </p>
            )}
            <ol
              aria-label={`Trace of: ${t.question}`}
              className="mt-1 divide-y divide-slate-100 dark:divide-slate-800"
            >
              {t.events.map((e) => (
                <Row key={`${e.stepId}-${e.type}`} e={e} />
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}
