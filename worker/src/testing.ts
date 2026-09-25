// Test doubles for the Worker's bindings (imported only by *.test.ts).
import {
  PROMPT_VERSION,
  parseSSE,
  TOOLSET_VERSION,
  type WireMessage,
} from "@browser-analyst/agent/gateway";
import { vi } from "vitest";
import type { Env } from "./env";
import worker from "./index";
import { signSession } from "./session";

export const ORIGIN = "https://browser-analyst.test";

export function makeEnv(overrides: Partial<Env> = {}) {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("<html></html>")) },
    AI: { run: vi.fn() },
    RL_STEP: { limit: vi.fn(async () => ({ success: true })) },
    RL_OTHER: { limit: vi.fn(async () => ({ success: true })) },
    GROQ_API_KEY: "test-groq-key",
    GEMINI_API_KEY: "test-gemini-key",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    SESSION_HMAC_SECRET: "test-hmac",
    ...overrides,
  } as unknown as Env & {
    ASSETS: { fetch: ReturnType<typeof vi.fn> };
    AI: { run: ReturnType<typeof vi.fn> };
  };
}

export function makeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, settle: () => Promise.all(pending) };
}

export const call = (request: Request, env: Env = makeEnv()) =>
  worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    env,
    makeCtx().ctx,
  );

export function post(path: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.7",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function sessionCookie(secret = "test-hmac") {
  return `ba_session=${(await signSession(secret)).value}`;
}

export async function stepRequest(
  messages: WireMessage[],
  extra: Record<string, unknown> = {},
  headers: HeadersInit = {},
) {
  return post(
    "/api/agent/step",
    {
      messages,
      toolsetVersion: TOOLSET_VERSION,
      promptVersion: PROMPT_VERSION,
      ...extra,
    },
    { cookie: await sessionCookie(), ...headers },
  );
}

export function sseStream(...events: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${e}\n\n`));
      c.close();
    },
  });
}

/** An OpenAI-compatible streaming response made of these chunks. */
export function openAiResponse(chunks: unknown[]): Response {
  return new Response(
    sseStream(...chunks.map((c) => JSON.stringify(c)), "[DONE]"),
    { headers: { "content-type": "text/event-stream" } },
  );
}

export const USAGE_CHUNK = {
  choices: [],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
};

export async function readEvents(res: Response) {
  const out: { event: string; data: unknown }[] = [];
  if (!res.body) return out;
  for await (const ev of parseSSE(res.body)) {
    out.push({ event: ev.event, data: JSON.parse(ev.data) });
  }
  return out;
}
