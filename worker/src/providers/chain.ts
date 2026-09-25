import type { Env } from "../env";
import { gemini, geminiLite, groq } from "./openaiCompat";
import {
  CHAIN,
  COLD_MS,
  FIRST_TOKEN_TIMEOUT_MS,
  type ProviderId,
} from "./providers.config";
import {
  type Provider,
  ProviderError,
  type ProviderEvent,
  type StepInput,
} from "./types";
import { workersAi } from "./workersAi";

export const PROVIDERS: Record<ProviderId, Provider> = {
  gemini,
  geminiLite,
  groq,
  workersAi,
};

/** Provider → time until which it is skipped. Per isolate, best effort. */
const coldUntil = new Map<ProviderId, number>();

export const isCold = (id: ProviderId, now = Date.now()) =>
  (coldUntil.get(id) ?? 0) > now;

export function resetCold(): void {
  coldUntil.clear();
}

export interface Attempt {
  provider: ProviderId;
  outcome: "ok" | "unconfigured" | "no_tools" | "cold" | "timeout" | "error";
  status?: number;
}

/** A provider that produced its first event; `rest` continues its stream. */
export interface Started {
  provider: Provider;
  first: ProviderEvent;
  rest: AsyncIterator<ProviderEvent>;
  abort: () => void;
  attempts: Attempt[];
}

export class AllProvidersFailed extends Error {
  readonly attempts: Attempt[];
  constructor(attempts: Attempt[]) {
    super("all providers failed");
    this.attempts = attempts;
  }
}

export interface ChainOptions {
  firstTokenMs?: number;
  providers?: Provider[];
}

const TIMEOUT = Symbol("timeout");

/**
 * Tries tool-capable providers in order until one streams a first event (text
 * or a tool call). Falls through on any error or when nothing arrives in
 * time; 429, 5xx, network errors, and timeouts also mark the provider cold.
 */
export async function startChain(
  input: StepInput,
  env: Env,
  opts: ChainOptions = {},
): Promise<Started> {
  const providers = opts.providers ?? CHAIN.map((id) => PROVIDERS[id]);
  const attempts: Attempt[] = [];
  for (const provider of providers) {
    const { id } = provider;
    if (!provider.supportsTools) {
      attempts.push({ provider: id, outcome: "no_tools" });
      continue;
    }
    if (!provider.configured(env)) {
      attempts.push({ provider: id, outcome: "unconfigured" });
      continue;
    }
    if (isCold(id)) {
      attempts.push({ provider: id, outcome: "cold" });
      continue;
    }
    const ctrl = new AbortController();
    const it = provider.stream(input, env, ctrl.signal)[Symbol.asyncIterator]();
    const next = it.next();
    next.catch(() => {}); // it may still reject after a timeout
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const first = await Promise.race([
        next,
        new Promise<typeof TIMEOUT>((resolve) => {
          timer = setTimeout(
            () => resolve(TIMEOUT),
            opts.firstTokenMs ??
              provider.firstEventMs ??
              FIRST_TOKEN_TIMEOUT_MS,
          );
        }),
      ]);
      if (first === TIMEOUT) {
        ctrl.abort();
        coldUntil.set(id, Date.now() + COLD_MS);
        attempts.push({ provider: id, outcome: "timeout" });
        continue;
      }
      if (first.done || first.value.type === "done") {
        throw new ProviderError(502, `${id} returned an empty reply`);
      }
      attempts.push({ provider: id, outcome: "ok" });
      return {
        provider,
        first: first.value,
        rest: it,
        abort: () => ctrl.abort(),
        attempts,
      };
    } catch (err) {
      ctrl.abort();
      const status = err instanceof ProviderError ? err.status : 503;
      if (status === 429 || status >= 500) {
        coldUntil.set(id, Date.now() + COLD_MS);
      }
      attempts.push({ provider: id, outcome: "error", status });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  throw new AllProvidersFailed(attempts);
}

/** For `/api/health`: which providers could take a step right now. */
export function providerStatus(env: Env) {
  return CHAIN.map((id) => ({
    id,
    model: PROVIDERS[id].model,
    tools: PROVIDERS[id].supportsTools,
    configured: PROVIDERS[id].configured(env),
    cold: isCold(id),
  }));
}
