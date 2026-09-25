// The only place model IDs live: providers retire models, so change them here.
// Model lists checked 2026-09-25 with each key's /models endpoint.

import { STEP_MAX_TOKENS } from "@browser-analyst/agent/gateway";

export type ProviderId = "gemini" | "geminiLite" | "groq" | "workersAi";

/**
 * Fallback order; only tool-capable providers join the agent chain. Flash-Lite
 * leads: Gemini 3.8 Flash's free tier allows only 20 requests per day (429
 * `generate_content_free_tier_requests, limit: 20`, 2026-09-25), so it backs
 * up Flash-Lite's "high demand" 503s instead.
 */
export const CHAIN: ProviderId[] = [
  "geminiLite",
  "gemini",
  "groq",
  "workersAi",
];

/** Fall through when no first token (or tool call) arrives within this time. */
export const FIRST_TOKEN_TIMEOUT_MS = 8_000;
/** How long a failing provider is skipped (per isolate, best effort). */
export const COLD_MS = 60_000;
/** Reasoning models count thinking tokens against max_tokens. */
const REASONING_ALLOWANCE = 1_200;

export interface OpenAiCompatible {
  url: string;
  model: string;
  max_tokens: number;
  extra: Record<string, unknown>;
}

export const GEMINI: OpenAiCompatible = {
  // https://ai.google.dev/gemini-api/docs/openai (OpenAI-compatible endpoint,
  // tools, reasoning_effort). Gemini 3 needs its thought signatures back:
  // tool_calls[].extra_content.google.thought_signature, or the documented
  // "skip_thought_signature_validator" for calls it didn't make.
  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  model: "gemini-3.8-flash",
  max_tokens: STEP_MAX_TOKENS + REASONING_ALLOWANCE,
  extra: { reasoning_effort: "low" },
};

/** Its own free quota; "high demand" 503s hit Gemini models separately. */
export const GEMINI_LITE: OpenAiCompatible = {
  ...GEMINI,
  model: "gemini-3.5-flash-lite",
};

export const GROQ: OpenAiCompatible = {
  // https://console.groq.com/docs/tool-use; free plan per
  // https://console.groq.com/docs/rate-limits (2026-09-25): 30 RPM, 1K RPD,
  // 8K TPM, 200K TPD, so it is a fallback, not the default. gpt-oss-120b
  // returned empty messages after tool results (2026-09-25), so Qwen, without
  // thinking.
  url: "https://api.groq.com/openai/v1/chat/completions",
  model: "qwen/qwen3.8-27b",
  max_tokens: STEP_MAX_TOKENS,
  extra: { reasoning_effort: "none" },
};

export const WORKERS_AI = {
  // https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/
  // (function calling; $0.35 / $0.75 per M input / output tokens, so roughly
  // 40 steps of the 10k free neurons per day). Called without streaming.
  model: "@cf/openai/gpt-oss-120b",
  max_tokens: STEP_MAX_TOKENS + REASONING_ALLOWANCE,
  /** No streaming, so the whole reply must arrive within this time. */
  timeoutMs: 25_000,
};
