import { TOOL_PAYLOAD } from "@browser-analyst/agent/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { makeEnv } from "../testing";
import { AllProvidersFailed, isCold, resetCold, startChain } from "./chain";
import type { ProviderId } from "./providers.config";
import { type Provider, ProviderError, type ProviderEvent } from "./types";

afterEach(() => resetCold());

const input = { messages: [], tools: TOOL_PAYLOAD };

function fake(
  id: ProviderId,
  behavior: ProviderEvent[] | ProviderError | "hang",
  extra: Partial<Provider> = {},
): Provider {
  return {
    id,
    model: `${id}-model`,
    supportsTools: true,
    configured: () => true,
    async *stream() {
      if (behavior === "hang") await new Promise(() => {});
      if (behavior instanceof ProviderError) throw behavior;
      yield* behavior as ProviderEvent[];
    },
    ...extra,
  };
}

const TEXT: ProviderEvent[] = [
  { type: "text", delta: "hi" },
  { type: "done", usage: null },
];

describe("startChain", () => {
  it("uses the first provider that streams", async () => {
    const started = await startChain(input, makeEnv(), {
      providers: [fake("gemini", TEXT), fake("groq", TEXT)],
    });
    expect(started.provider.id).toBe("gemini");
    expect(started.first).toEqual({ type: "text", delta: "hi" });
  });

  it("falls through on 429 and 5xx, marking those providers cold", async () => {
    const started = await startChain(input, makeEnv(), {
      providers: [
        fake("gemini", new ProviderError(429, "quota")),
        fake("groq", new ProviderError(502, "bad gateway")),
        fake("workersAi", [{ type: "progress" }, ...TEXT]),
      ],
    });
    expect(started.provider.id).toBe("workersAi");
    expect(started.first).toEqual({ type: "progress" });
    expect(
      started.attempts.map((a) => `${a.provider}:${a.status ?? a.outcome}`),
    ).toEqual(["gemini:429", "groq:502", "workersAi:ok"]);
    expect(isCold("gemini")).toBe(true);
    expect(isCold("groq")).toBe(true);
  });

  it("skips unconfigured, tool-less, and cold providers", async () => {
    await startChain(input, makeEnv(), {
      providers: [
        fake("gemini", new ProviderError(503, "down")),
        fake("groq", TEXT),
      ],
    });
    const started = await startChain(input, makeEnv(), {
      providers: [
        fake("gemini", TEXT),
        fake("groq", TEXT, { configured: () => false }),
        fake("workersAi", TEXT, { supportsTools: false }),
      ].concat(fake("groq", TEXT)),
    });
    expect(started.attempts.map((a) => a.outcome)).toEqual([
      "cold",
      "unconfigured",
      "no_tools",
      "ok",
    ]);
  });

  it("falls through when no first event arrives in time", async () => {
    const started = await startChain(input, makeEnv(), {
      firstTokenMs: 20,
      providers: [fake("gemini", "hang"), fake("groq", TEXT)],
    });
    expect(started.attempts[0]).toEqual({
      provider: "gemini",
      outcome: "timeout",
    });
    expect(isCold("gemini")).toBe(true);
  });

  it("treats an empty reply as a failure and reports every attempt", async () => {
    const err = await startChain(input, makeEnv(), {
      providers: [
        fake("gemini", [{ type: "done", usage: null }]),
        fake("groq", new ProviderError(400, "bad request")),
      ],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllProvidersFailed);
    expect((err as AllProvidersFailed).attempts).toEqual([
      { provider: "gemini", outcome: "error", status: 502 },
      { provider: "groq", outcome: "error", status: 400 },
    ]);
    // 4xx other than 429 is the request's fault, not the provider's.
    expect(isCold("groq")).toBe(false);
  });
});
