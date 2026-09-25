import { describe, expect, it } from "vitest";
import { call, makeEnv, ORIGIN } from "./testing";

describe("worker routing", () => {
  it("GET /api/health reports versions and providers without secrets", async () => {
    const res = await call(new Request(`${ORIGIN}/api/health`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      status: string;
      toolsetVersion: string;
      promptVersion: string;
      providers: { id: string; configured: boolean; tools: boolean }[];
    };
    expect(body.status).toBe("ok");
    expect(body.toolsetVersion).toMatch(/^tools-v/);
    expect(body.promptVersion).toMatch(/^prompt-v/);
    expect(body.providers.map((p) => [p.id, p.configured, p.tools])).toEqual([
      ["gemini", true, true],
      ["geminiLite", true, true],
      ["groq", true, true],
      ["workersAi", true, true],
    ]);
    expect(JSON.stringify(body)).not.toContain("test-groq-key");
  });

  it("reports unconfigured providers", async () => {
    const env = makeEnv({ GEMINI_API_KEY: undefined });
    const res = await call(new Request(`${ORIGIN}/api/health`), env);
    const body = (await res.json()) as {
      providers: { id: string; configured: boolean }[];
    };
    expect(body.providers.find((p) => p.id === "gemini")?.configured).toBe(
      false,
    );
  });

  it("rejects non-GET on /api/health", async () => {
    const res = await call(
      new Request(`${ORIGIN}/api/health`, { method: "POST" }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("returns a JSON 404 for unknown /api routes", async () => {
    const env = makeEnv();
    const res = await call(new Request(`${ORIGIN}/api/nope`), env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ reason: "not_found" });
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("serves static assets outside /api", async () => {
    const env = makeEnv();
    await call(new Request(`${ORIGIN}/workspace`), env);
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("returns 429 when the rate limiter says no", async () => {
    const env = makeEnv({
      RL_OTHER: { limit: async () => ({ success: false }) },
    });
    const res = await call(new Request(`${ORIGIN}/api/health`), env);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ reason: "rate_limit" });
    expect(res.headers.get("retry-after")).toBe("60");
  });
});
