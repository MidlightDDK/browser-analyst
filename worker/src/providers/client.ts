// A ModelClient that calls one provider directly (no gateway): the provider
// contract test uses it, and so will the benchmark harness.

import {
  type ModelClient,
  ModelError,
  type ModelStepResponse,
  SYSTEM_PROMPT,
  TOOL_PAYLOAD,
  type ToolCall,
  type Usage,
} from "@browser-analyst/agent/gateway";
import type { Env } from "../env";
import { type Provider, ProviderError } from "./types.ts";

export function providerClient(provider: Provider, env: Env): ModelClient {
  return {
    async step({ messages, signal, onText }): Promise<ModelStepResponse> {
      const t0 = Date.now();
      let text = "";
      const toolCalls: ToolCall[] = [];
      let usage: Usage | null = null;
      try {
        for await (const ev of provider.stream(
          {
            messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
            tools: TOOL_PAYLOAD,
          },
          env,
          signal ?? new AbortController().signal,
        )) {
          if (ev.type === "text") {
            text += ev.delta;
            onText?.(ev.delta);
          } else if (ev.type === "tool_call") toolCalls.push(ev.call);
          else if (ev.type === "done") usage = ev.usage;
        }
      } catch (err) {
        const status = err instanceof ProviderError ? err.status : 0;
        throw new ModelError(
          status === 429 ? "rate_limit" : "upstream",
          `${provider.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return {
        text,
        toolCalls,
        usage,
        provider: provider.id,
        model: provider.model,
        latencyMs: Date.now() - t0,
      };
    },
  };
}
