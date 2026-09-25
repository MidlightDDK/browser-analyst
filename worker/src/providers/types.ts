import type {
  TOOL_PAYLOAD,
  ToolCall,
  Usage,
  WireMessage,
} from "@browser-analyst/agent/gateway";
import type { Env } from "../env";
import type { ProviderId } from "./providers.config";

export type ProviderMessage = WireMessage | { role: "system"; content: string };

export interface StepInput {
  /** The system prompt first, then the client's messages. */
  messages: ProviderMessage[];
  tools: typeof TOOL_PAYLOAD;
}

/** What every adapter normalizes its stream to. */
export type ProviderEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  /** A tool call started streaming; counts as the first token. */
  | { type: "progress" }
  | { type: "done"; usage: Usage | null };

export interface Provider {
  id: ProviderId;
  model: string;
  /** Only tool-capable providers join the agent chain. */
  supportsTools: boolean;
  /** Key or binding present. */
  configured(env: Env): boolean;
  /** Overrides FIRST_TOKEN_TIMEOUT_MS (non-streaming adapters). */
  firstEventMs?: number;
  /** Streams text, tool calls (each complete), then exactly one `done`. */
  stream(
    input: StepInput,
    env: Env,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}

/** An upstream failure; `status` is the HTTP status, or 503 for binding errors. */
export class ProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function toUsage(u: unknown): Usage | null {
  const { prompt_tokens, completion_tokens } = (u ?? {}) as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  return typeof prompt_tokens === "number" &&
    typeof completion_tokens === "number"
    ? { input_tokens: prompt_tokens, output_tokens: completion_tokens }
    : null;
}

/** Tool arguments as a JSON string, whatever shape the provider used. */
export function argumentsString(args: unknown): string {
  if (typeof args === "string") return args;
  return JSON.stringify(args ?? {});
}

let nextId = 0;
/** An id for providers that don't send one (unique per isolate). */
export const newCallId = () =>
  `call_${Date.now().toString(36)}${(nextId++).toString(36)}`;
