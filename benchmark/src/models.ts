// Models the harness can run: the gateway's providers called directly (the
// same adapters and system prompt), behind a disk cache, a per-provider rate
// limiter, and retries for rate limits and "high demand" errors.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  type ModelClient,
  ModelError,
  type ModelStepRequest,
  type ModelStepResponse,
  SYSTEM_PROMPT,
  TOOL_PAYLOAD,
  type WireMessage,
} from "@browser-analyst/agent";
import { providerClient } from "../../worker/src/providers/client.ts";
import {
  gemini,
  geminiLite,
  groq,
} from "../../worker/src/providers/openaiCompat.ts";
import type { Provider } from "../../worker/src/providers/types.ts";
import { BENCH_DIR } from "./datasets.ts";

interface ModelEntry {
  provider: Provider;
  /** Requests per minute we allow ourselves (below each free tier's limit). */
  rpm: number;
}

// Free-tier limits: https://ai.google.dev/gemini-api/docs/rate-limits and
// https://console.groq.com/docs/rate-limits. Binding ones (2026-09-25):
// Flash-Lite 500 requests/day per project (429 quotaId
// GenerateRequestsPerDayPerProjectPerModel-FreeTier; a full run is ~370),
// Flash 20/day, Groq 8K tokens/min at ~3.5K tokens per step.
export const MODELS: Record<string, ModelEntry> = {
  geminiLite: { provider: geminiLite, rpm: 10 },
  gemini: { provider: gemini, rpm: 5 },
  groq: { provider: groq, rpm: 2 },
};

export const CACHE_DIR = `${BENCH_DIR}.cache/`;

export interface ClientStats {
  calls: number;
  cacheHits: number;
}

/** A step with no complete reply by then is retried like a 503 (the gateway
 * has its own first-token fallback; direct calls need this instead). */
const STEP_TIMEOUT_MS = 90_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new ModelError("aborted", "aborted"));
    });
  });

/** One request at a time, at most `rpm` per minute. */
function limiter(rpm: number) {
  const gap = 60_000 / rpm;
  let next = 0;
  let chain = Promise.resolve();
  return () => {
    const turn = chain.then(async () => {
      const wait = next - Date.now();
      if (wait > 0) await sleep(wait);
      next = Date.now() + gap;
    });
    chain = turn;
    return turn;
  };
}

/**
 * The cache key ignores `elapsed_ms` in tool results and the random spotlight
 * id: both vary run to run, and without this every step after the first would
 * miss.
 */
export function cacheKey(
  model: string,
  messages: readonly WireMessage[],
): string {
  const stable = messages.map((m) =>
    m.role === "tool" || m.role === "user"
      ? {
          ...m,
          content: m.content
            .replace(/"elapsed_ms":\d+/g, '"elapsed_ms":0')
            .replace(/<data id="[0-9a-f]+">/g, '<data id="x">'),
        }
      : m,
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        model,
        system: SYSTEM_PROMPT,
        tools: TOOL_PAYLOAD,
        messages: stable,
      }),
    )
    .digest("hex");
}

/**
 * Rate limits back off for up to ~4 minutes; 503s ("high demand") and stalls
 * retry 6 times over ~3.5 minutes.
 */
async function withRetries(
  name: string,
  signal: AbortSignal | undefined,
  step: () => Promise<ModelStepResponse>,
): Promise<ModelStepResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (err) {
      if (!(err instanceof ModelError) || signal?.aborted) throw err;
      const limited = err.reason === "rate_limit";
      const busy =
        err.reason === "upstream" &&
        /HTTP 50[0234]|fetch failed/.test(err.message);
      const wait =
        limited && attempt < 5
          ? 15_000 * 2 ** (attempt - 1)
          : busy && attempt < 7
            ? 10_000 * attempt
            : 0;
      if (!wait) {
        if (limited)
          throw new ModelError(
            "quota",
            `${err.message} (rate limited 5 times: likely the daily quota)`,
          );
        throw err;
      }
      console.error(
        `  ${name}: ${err.message}; retry ${attempt} in ${wait / 1000} s`,
      );
      await sleep(wait, signal);
    }
  }
}

export function benchClient(
  name: string,
  env: Record<string, string | undefined>,
  stats: ClientStats,
  opts: { cache?: boolean } = {},
): ModelClient {
  const entry = MODELS[name];
  if (!entry)
    throw new Error(
      `unknown model ${name}; one of ${Object.keys(MODELS).join(", ")}`,
    );
  const { provider } = entry;
  // biome-ignore lint/suspicious/noExplicitAny: the Worker's Env type only needs the keys here.
  const live = providerClient(provider, env as any);
  const take = limiter(entry.rpm);
  const dir = `${CACHE_DIR}${provider.model.replaceAll(/[^\w.-]/g, "_")}/`;
  return {
    async step(req: ModelStepRequest): Promise<ModelStepResponse> {
      stats.calls++;
      const key = cacheKey(provider.model, req.messages);
      const path = `${dir}${key}.json`;
      if (opts.cache !== false && existsSync(path)) {
        stats.cacheHits++;
        return JSON.parse(await readFile(path, "utf8")) as ModelStepResponse;
      }
      if (!provider.configured(env as never))
        throw new ModelError(
          "invalid",
          `${name}: API key missing (set it in .env)`,
        );
      const res = await withRetries(name, req.signal, async () => {
        await take();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), STEP_TIMEOUT_MS);
        const stop = () => ctrl.abort();
        req.signal?.addEventListener("abort", stop);
        try {
          return await live.step({
            messages: req.messages,
            signal: ctrl.signal,
          });
        } catch (err) {
          if (ctrl.signal.aborted && !req.signal?.aborted)
            throw new ModelError(
              "upstream",
              `HTTP 504: no complete reply in ${STEP_TIMEOUT_MS / 1000} s`,
            );
          throw err;
        } finally {
          clearTimeout(timer);
          req.signal?.removeEventListener("abort", stop);
        }
      });
      await mkdir(dir, { recursive: true });
      await writeFile(path, JSON.stringify(res));
      return res;
    },
  };
}
