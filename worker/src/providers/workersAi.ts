import { prepareMessages } from "./openaiCompat";
import { WORKERS_AI } from "./providers.config";
import {
  argumentsString,
  newCallId,
  type Provider,
  ProviderError,
  type ProviderEvent,
  toUsage,
} from "./types";

interface RawCall {
  id?: string;
  name?: string;
  arguments?: unknown;
  function?: { name?: string; arguments?: unknown };
}

/**
 * Workers AI replies in the OpenAI shape (`choices[0].message`) or the legacy
 * one (`{response, tool_calls: [{name, arguments}]}`), depending on the model.
 */
export function parseWorkersAi(out: unknown): ProviderEvent[] {
  const o = (out ?? {}) as {
    response?: unknown;
    tool_calls?: RawCall[];
    choices?: { message?: { content?: unknown; tool_calls?: RawCall[] } }[];
    usage?: unknown;
  };
  const msg = o.choices?.[0]?.message;
  const text =
    typeof msg?.content === "string"
      ? msg.content
      : typeof o.response === "string"
        ? o.response
        : "";
  const events: ProviderEvent[] = text ? [{ type: "text", delta: text }] : [];
  for (const c of msg?.tool_calls ?? o.tool_calls ?? [])
    events.push({
      type: "tool_call",
      call: {
        id: c.id ?? newCallId(),
        name: c.function?.name ?? c.name ?? "unknown",
        arguments: argumentsString(c.function?.arguments ?? c.arguments),
      },
    });
  events.push({ type: "done", usage: toUsage(o.usage) });
  return events;
}

/** Workers AI through the `AI` binding (no key), without streaming. */
export const workersAi: Provider = {
  id: "workersAi",
  model: WORKERS_AI.model,
  supportsTools: true,
  firstEventMs: WORKERS_AI.timeoutMs,
  configured: (env) => Boolean(env.AI),
  async *stream(input, env, signal) {
    let out: unknown;
    try {
      out = await env.AI.run(WORKERS_AI.model, {
        // The binding's schema wants string content, even beside tool calls.
        messages: prepareMessages(input.messages, "openai").map((m) =>
          m.role === "assistant" && m.content === null
            ? { ...m, content: "" }
            : m,
        ),
        tools: input.tools,
        max_tokens: WORKERS_AI.max_tokens,
        temperature: 0,
      });
    } catch (err) {
      // Binding errors carry no status (e.g. "3036: daily neuron limit").
      throw new ProviderError(503, String(err));
    }
    if (signal.aborted) return;
    yield* parseWorkersAi(out);
  },
};
