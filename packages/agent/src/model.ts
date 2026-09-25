// How the loop talks to a model: the browser goes through the gateway
// (gateway-client.ts); the benchmark harness calls providers directly; tests
// script one.

import type { ToolCall, Usage, WireMessage } from "./wire.ts";

export interface ModelStepRequest {
  messages: WireMessage[];
  signal?: AbortSignal;
  /** Streamed text as it arrives. */
  onText?: (delta: string) => void;
}

export interface ModelStepResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface ModelClient {
  step(req: ModelStepRequest): Promise<ModelStepResponse>;
}

/**
 * Why a step failed. `quota` means every free provider is exhausted (the UI
 * shows a friendly message); `upstream` and `network` are worth one retry.
 */
export type ModelErrorReason =
  | "quota"
  | "rate_limit"
  | "session"
  | "version"
  | "invalid"
  | "upstream"
  | "network"
  | "aborted";

export class ModelError extends Error {
  readonly reason: ModelErrorReason;
  constructor(reason: ModelErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}
