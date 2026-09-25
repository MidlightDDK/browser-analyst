// A ModelClient over the Worker's `POST /api/agent/step` SSE stream.

import {
  type ModelClient,
  ModelError,
  type ModelErrorReason,
  type ModelStepRequest,
  type ModelStepResponse,
} from "./model.ts";
import { PROMPT_VERSION } from "./prompts/system.ts";
import { parseSSE } from "./sse.ts";
import { TOOLSET_VERSION } from "./tools/schemas.ts";
import type { StepEvents, StepRequestBody, ToolCall } from "./wire.ts";

export interface GatewayClientOptions {
  /** Origin of the gateway; "" means same origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Makes sure a session cookie exists; `force` after the gateway rejected it. */
  ensureSession?: (force: boolean) => Promise<void>;
  /** Sees each request body as sent (the "What the model saw" drawer). */
  onRequest?: (body: StepRequestBody) => void;
}

const STATUS_REASON: Record<number, ModelErrorReason> = {
  400: "invalid",
  401: "session",
  403: "session",
  409: "version",
  413: "invalid",
  429: "rate_limit",
  503: "quota",
};

const MESSAGES: Record<ModelErrorReason, string> = {
  quota:
    "The free AI quota is used up for now. Quotas reset daily; please try again later.",
  rate_limit:
    "Too many requests in the last minute. Wait a moment, then try again.",
  session: "Couldn't start a session (the bot check didn't pass).",
  version: "This page is out of date. Reload it to get the latest version.",
  invalid: "The gateway rejected the request.",
  upstream: "The model provider failed mid-answer.",
  network: "Couldn't reach the gateway.",
  aborted: "Stopped.",
};

export function gatewayClient(opts: GatewayClientOptions = {}): ModelClient {
  const doFetch = opts.fetch ?? fetch;
  const url = `${opts.baseUrl ?? ""}/api/agent/step`;

  async function post(
    body: StepRequestBody,
    signal: AbortSignal | undefined,
    retried: boolean,
  ): Promise<Response> {
    try {
      await opts.ensureSession?.(retried);
    } catch (err) {
      throw new ModelError(
        "session",
        err instanceof Error ? err.message : MESSAGES.session,
      );
    }
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw new ModelError("aborted", MESSAGES.aborted);
      throw new ModelError("network", `${MESSAGES.network} ${String(err)}`);
    }
    if (res.ok) return res;
    const { reason } = (await res.json().catch(() => ({}))) as {
      reason?: string;
    };
    const kind: ModelErrorReason =
      STATUS_REASON[res.status] ?? (res.status >= 500 ? "upstream" : "invalid");
    if (kind === "session" && !retried && opts.ensureSession)
      return post(body, signal, true);
    throw new ModelError(
      kind,
      kind === "invalid" && reason
        ? `${MESSAGES.invalid} (${reason})`
        : MESSAGES[kind],
    );
  }

  return {
    async step(req: ModelStepRequest): Promise<ModelStepResponse> {
      const body: StepRequestBody = {
        messages: req.messages,
        toolsetVersion: TOOLSET_VERSION,
        promptVersion: PROMPT_VERSION,
      };
      opts.onRequest?.(body);
      const res = await post(body, req.signal, false);
      if (!res.body) throw new ModelError("upstream", MESSAGES.upstream);
      let text = "";
      const toolCalls: ToolCall[] = [];
      let done: StepEvents["done"] | null = null;
      try {
        for await (const ev of parseSSE(res.body)) {
          if (ev.event === "text") {
            const { delta } = JSON.parse(ev.data) as StepEvents["text"];
            text += delta;
            req.onText?.(delta);
          } else if (ev.event === "tool_call") {
            toolCalls.push(JSON.parse(ev.data) as StepEvents["tool_call"]);
          } else if (ev.event === "done") {
            done = JSON.parse(ev.data) as StepEvents["done"];
          } else if (ev.event === "error") {
            throw new ModelError("upstream", MESSAGES.upstream);
          }
        }
      } catch (err) {
        if (req.signal?.aborted)
          throw new ModelError("aborted", MESSAGES.aborted);
        if (err instanceof ModelError) throw err;
        throw new ModelError("upstream", `${MESSAGES.upstream} ${String(err)}`);
      }
      if (!done) throw new ModelError("upstream", MESSAGES.upstream);
      return {
        text,
        toolCalls,
        usage: done.usage,
        provider: done.provider,
        model: done.model,
        latencyMs: done.latencyMs,
      };
    },
  };
}
