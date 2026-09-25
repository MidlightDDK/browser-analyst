// POST /api/agent/step: validate → session → limit → add the system prompt
// and tool schemas → stream one model step as normalized SSE events.

import {
  byteLength,
  formatSSE,
  MAX_MESSAGES,
  MAX_MESSAGES_BYTES,
  MAX_TOOL_CALLS_PER_MESSAGE,
  MAX_TOOL_MESSAGE_BYTES,
  messagesBytes,
  PROMPT_VERSION,
  type StepEvents,
  SYSTEM_PROMPT,
  TOOL_PAYLOAD,
  TOOLSET_VERSION,
  type Usage,
} from "@browser-analyst/agent/gateway";
import * as z from "zod/mini";
import type { Env } from "./env";
import {
  HttpError,
  log,
  rateLimit,
  readJson,
  requireMethod,
  requireSameOrigin,
} from "./http";
import {
  AllProvidersFailed,
  type ChainOptions,
  startChain,
} from "./providers/chain";
import { hasSession } from "./session";

/** Messages (24 KB) plus JSON overhead and thought signatures. */
const MAX_BODY_BYTES = 96 * 1024;

const text = (max: number) => z.string().check(z.maxLength(max));

const ToolCall = z.object({
  id: text(128),
  type: z.literal("function"),
  function: z.object({ name: text(64), arguments: text(8192) }),
  extra_content: z.optional(
    z.object({
      google: z.optional(
        z.object({ thought_signature: z.optional(text(16 * 1024)) }),
      ),
    }),
  ),
});

const Message = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: text(MAX_BODY_BYTES) }),
  z.object({
    role: z.literal("assistant"),
    content: z.nullable(text(MAX_BODY_BYTES)),
    tool_calls: z.optional(
      z
        .array(ToolCall)
        .check(z.minLength(1), z.maxLength(MAX_TOOL_CALLS_PER_MESSAGE)),
    ),
  }),
  z.object({
    role: z.literal("tool"),
    tool_call_id: text(128),
    content: text(MAX_BODY_BYTES),
  }),
]);

const Body = z.object({
  messages: z.array(Message).check(z.minLength(1), z.maxLength(MAX_MESSAGES)),
  toolsetVersion: text(64),
  promptVersion: text(64),
});

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store",
};

const enc = new TextEncoder();

export async function handleAgentStep(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  opts: ChainOptions = {},
): Promise<Response> {
  requireMethod(request, "POST");
  requireSameOrigin(request);
  if (!(await hasSession(request, env))) throw new HttpError(401, "session");
  await rateLimit(env.RL_STEP, request);
  const body = await readJson(request, Body, MAX_BODY_BYTES);
  if (
    body.toolsetVersion !== TOOLSET_VERSION ||
    body.promptVersion !== PROMPT_VERSION
  ) {
    throw new HttpError(409, "version");
  }
  const { messages } = body;
  if (
    messagesBytes(messages) > MAX_MESSAGES_BYTES ||
    messages.some(
      (m) =>
        m.role === "tool" && byteLength(m.content) > MAX_TOOL_MESSAGE_BYTES,
    )
  ) {
    throw new HttpError(413, "too_large");
  }
  const steps = messages.filter((m) => m.role === "assistant").length + 1;

  const t0 = Date.now();
  let started: Awaited<ReturnType<typeof startChain>>;
  try {
    started = await startChain(
      {
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        tools: TOOL_PAYLOAD,
      },
      env,
      opts,
    );
  } catch (err) {
    if (!(err instanceof AllProvidersFailed)) throw err;
    log({
      route: "agent/step",
      status: 503,
      latencyMs: Date.now() - t0,
      steps,
      provider: err.attempts
        .map((a) => `${a.provider}:${a.status ?? a.outcome}`)
        .join(","),
    });
    throw new HttpError(503, "quota");
  }

  const { provider, rest, abort } = started;
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const send = <K extends keyof StepEvents>(event: K, data: StepEvents[K]) =>
    writer.write(enc.encode(formatSSE(event, data)));

  const pump = async () => {
    let usage: Usage | null = null;
    let status: number | string = 200;
    try {
      let next: IteratorResult<(typeof started)["first"]> = {
        done: false,
        value: started.first,
      };
      while (!next.done) {
        const ev = next.value;
        if (ev.type === "text") await send("text", { delta: ev.delta });
        else if (ev.type === "tool_call") await send("tool_call", ev.call);
        else if (ev.type === "done") usage = ev.usage;
        next = await rest.next();
      }
      await send("done", {
        usage,
        provider: provider.id,
        model: provider.model,
        latencyMs: Date.now() - t0,
      });
    } catch {
      // The provider failed mid-stream, or the client went away.
      abort();
      status = "stream_error";
      await send("error", { reason: "provider" }).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
      log({
        route: "agent/step",
        provider: provider.id,
        status,
        latencyMs: Date.now() - t0,
        tokens: usage ? usage.input_tokens + usage.output_tokens : 0,
        steps,
      });
    }
  };
  ctx.waitUntil(pump());
  return new Response(readable, { headers: SSE_HEADERS });
}
