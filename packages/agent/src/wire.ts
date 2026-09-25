// The `/api/agent/step` contract, shared by the browser client and the Worker.
// Messages use the OpenAI chat format; the Worker prepends the system prompt
// and the tool schemas, so clients never send either.

/** Opaque provider data a client must echo back unchanged (Gemini 3 thought signatures). */
export interface ExtraContent {
  google?: { thought_signature?: string };
}

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  extra_content?: ExtraContent;
}

export type WireMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface StepRequestBody {
  messages: WireMessage[];
  toolsetVersion: string;
  promptVersion: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

/** A tool call normalized to OpenAI style; `arguments` is a JSON string. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  extra_content?: ExtraContent;
}

/** Server-sent events of `/api/agent/step`, by event name. */
export interface StepEvents {
  text: { delta: string };
  tool_call: ToolCall;
  done: {
    usage: Usage | null;
    provider: string;
    model: string;
    latencyMs: number;
  };
  error: { reason: string };
}

// Gateway caps. The client compacts its context to fit them; the Worker
// rejects anything larger (413). Thought signatures don't count toward the
// byte caps (they are opaque and only go back to the provider that made them).
export const MAX_MESSAGES = 24;
export const MAX_MESSAGES_BYTES = 24 * 1024;
export const MAX_TOOL_MESSAGE_BYTES = 4 * 1024;
export const MAX_TOOL_CALLS_PER_MESSAGE = 5;
/** Visible output budget per step (reasoning models get extra; see the Worker's providers.config.ts). */
export const STEP_MAX_TOKENS = 800;

const enc = new TextEncoder();
export const byteLength = (s: string) => enc.encode(s).length;

/** Bytes counted toward MAX_MESSAGES_BYTES: the messages without extra_content. */
export function messagesBytes(messages: readonly WireMessage[]): number {
  return byteLength(
    JSON.stringify(messages, (key, value) =>
      key === "extra_content" ? undefined : value,
    ),
  );
}
