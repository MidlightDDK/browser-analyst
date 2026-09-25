import { parseSSE, type Usage } from "@browser-analyst/agent/gateway";
import type { Env } from "../env";
import {
  GEMINI,
  GEMINI_31_LITE,
  GEMINI_LITE,
  GEMMA_4,
  GROQ,
  type OpenAiCompatible,
  type ProviderId,
} from "./providers.config.ts";
import {
  argumentsString,
  newCallId,
  type Provider,
  ProviderError,
  type ProviderEvent,
  type ProviderMessage,
  toUsage,
} from "./types.ts";

/** Gemini's documented value for function calls it didn't sign itself. */
export const SKIP_SIGNATURE = "skip_thought_signature_validator";

type Dialect = "gemini" | "openai";

/**
 * Provider-specific message fixes. Gemini 3 validates the thought signature on
 * the first tool call of each assistant message; other providers get no
 * extra_content at all.
 */
export function prepareMessages(
  messages: ProviderMessage[],
  dialect: Dialect,
): ProviderMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || !m.tool_calls?.length) return m;
    if (dialect === "gemini") {
      if (m.tool_calls.some((c) => c.extra_content?.google?.thought_signature))
        return m;
      const [first, ...rest] = m.tool_calls;
      if (!first) return m;
      return {
        ...m,
        tool_calls: [
          {
            ...first,
            extra_content: { google: { thought_signature: SKIP_SIGNATURE } },
          },
          ...rest,
        ],
      };
    }
    return {
      ...m,
      tool_calls: m.tool_calls.map(({ extra_content: _, ...c }) => c),
    };
  });
}

interface StreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: unknown };
        extra_content?: { google?: { thought_signature?: string } };
      }[];
    };
  }[];
  usage?: unknown;
  x_groq?: { usage?: unknown };
  error?: { message?: string; code?: string; failed_generation?: string };
}

/**
 * Groq rejects a malformed tool call with `tool_use_failed` and the raw
 * generation. Hand it to the loop as a tool call with the raw text as its
 * arguments, so the model sees the parse error and can fix it.
 */
export function failedToolCall(
  error: StreamChunk["error"],
): ProviderEvent | null {
  if (error?.code !== "tool_use_failed") return null;
  const raw = error.failed_generation ?? "";
  let name = raw.match(/"name"\s*:\s*"([\w-]+)"/)?.[1] ?? "unknown";
  let args = raw;
  try {
    const parsed = JSON.parse(raw) as { name?: string; arguments?: unknown };
    if (typeof parsed.name === "string") name = parsed.name;
    if (parsed.arguments !== undefined)
      args = argumentsString(parsed.arguments);
  } catch {
    // keep the raw text: the loop reports it as invalid JSON
  }
  return {
    type: "tool_call",
    call: { id: newCallId(), name, arguments: args || "(empty)" },
  };
}

function errorOf(body: string): StreamChunk["error"] {
  try {
    return (JSON.parse(body) as Pick<StreamChunk, "error">).error;
  } catch {
    return undefined;
  }
}

/** A provider behind an OpenAI-compatible chat-completions endpoint. */
function openAiCompatible(
  id: ProviderId,
  cfg: OpenAiCompatible,
  key: (env: Env) => string | undefined,
  dialect: Dialect,
): Provider {
  return {
    id,
    model: cfg.model,
    supportsTools: true,
    configured: (env) => Boolean(key(env)),
    async *stream(input, env, signal) {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key(env)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: prepareMessages(input.messages, dialect),
          tools: input.tools,
          tool_choice: "auto",
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0,
          max_tokens: cfg.max_tokens,
          ...cfg.extra,
        }),
        signal,
      }).catch((err: unknown) => {
        // Node's fetch hides the network error in `cause` (ECONNRESET, ...).
        const cause = (err as { cause?: unknown })?.cause;
        throw new ProviderError(
          503,
          `${id} fetch failed: ${String(err)}${cause ? ` (${String(cause)})` : ""}`,
        );
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        const failed =
          res.status === 400 ? failedToolCall(errorOf(text)) : null;
        if (failed) {
          yield failed;
          yield { type: "done", usage: null };
          return;
        }
        throw new ProviderError(res.status, `${id} HTTP ${res.status}`);
      }

      let usage: Usage | null = null;
      // Tool calls stream in fragments keyed by index (Gemini may omit it).
      const calls = new Map<
        string,
        {
          id?: string;
          name: string;
          args: string;
          extra?: { google?: { thought_signature?: string } };
        }
      >();
      for await (const ev of parseSSE(res.body)) {
        if (ev.data === "[DONE]") break;
        const chunk = JSON.parse(ev.data) as StreamChunk;
        if (chunk.error) {
          const failed = failedToolCall(chunk.error);
          if (failed) {
            yield failed;
            break;
          }
          throw new ProviderError(502, `${id}: ${chunk.error.message}`);
        }
        usage = toUsage(chunk.usage ?? chunk.x_groq?.usage) ?? usage;
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) yield { type: "text", delta: delta.content };
        for (const tc of delta?.tool_calls ?? []) {
          const k =
            typeof tc.index === "number"
              ? `i${tc.index}`
              : tc.id
                ? `id${tc.id}`
                : `n${calls.size}`;
          let entry = calls.get(k);
          if (!entry) {
            entry = { name: "", args: "" };
            calls.set(k, entry);
            yield { type: "progress" };
          }
          if (tc.id) entry.id ??= tc.id;
          if (tc.function?.name && !entry.name) entry.name = tc.function.name;
          if (tc.function?.arguments !== undefined)
            entry.args += argumentsString(tc.function.arguments);
          if (tc.extra_content) entry.extra = tc.extra_content;
        }
      }
      for (const c of calls.values())
        yield {
          type: "tool_call",
          call: {
            id: c.id ?? newCallId(),
            name: c.name,
            arguments: c.args || "{}",
            ...(c.extra ? { extra_content: c.extra } : {}),
          },
        };
      yield { type: "done", usage };
    },
  };
}

export const gemini = openAiCompatible(
  "gemini",
  GEMINI,
  (env) => env.GEMINI_API_KEY,
  "gemini",
);
export const geminiLite = openAiCompatible(
  "geminiLite",
  GEMINI_LITE,
  (env) => env.GEMINI_API_KEY,
  "gemini",
);
export const gemini31Lite = openAiCompatible(
  "gemini31Lite",
  GEMINI_31_LITE,
  (env) => env.GEMINI_API_KEY,
  "gemini",
);
export const gemma4 = openAiCompatible(
  "gemma4",
  GEMMA_4,
  (env) => env.GEMINI_API_KEY,
  "gemini",
);
export const groq = openAiCompatible(
  "groq",
  GROQ,
  (env) => env.GROQ_API_KEY,
  "openai",
);
