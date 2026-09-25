import { describe, expect, it } from "vitest";
import { gatewayClient } from "./gateway-client.ts";
import { ModelError } from "./model.ts";
import { formatSSE } from "./sse.ts";
import { TOOLSET_VERSION } from "./tools/schemas.ts";

const sse = (...events: [string, unknown][]) =>
  new Response(events.map(([e, d]) => formatSSE(e, d)).join(""), {
    headers: { "content-type": "text/event-stream" },
  });

const done = {
  usage: { input_tokens: 10, output_tokens: 2 },
  provider: "gemini",
  model: "m",
  latencyMs: 9,
};

function fakeFetch(...responses: Response[]) {
  const bodies: unknown[] = [];
  const fn = async (_url: string, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "null"));
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  };
  return { fn: fn as unknown as typeof fetch, bodies };
}

const messages = [{ role: "user" as const, content: "hi" }];

describe("gatewayClient", () => {
  it("collects streamed text and tool calls", async () => {
    const { fn, bodies } = fakeFetch(
      sse(
        ["text", { delta: "Let me " }],
        ["text", { delta: "check." }],
        ["tool_call", { id: "a", name: "list_tables", arguments: "{}" }],
        ["done", done],
      ),
    );
    const deltas: string[] = [];
    const res = await gatewayClient({ fetch: fn }).step({
      messages,
      onText: (d) => deltas.push(d),
    });
    expect(res).toEqual({
      text: "Let me check.",
      toolCalls: [{ id: "a", name: "list_tables", arguments: "{}" }],
      usage: done.usage,
      provider: "gemini",
      model: "m",
      latencyMs: 9,
    });
    expect(deltas).toEqual(["Let me ", "check."]);
    expect(bodies[0]).toMatchObject({
      messages,
      toolsetVersion: TOOLSET_VERSION,
    });
  });

  it("renews the session once after a 401", async () => {
    const forced: boolean[] = [];
    const { fn } = fakeFetch(
      Response.json({ reason: "session" }, { status: 401 }),
      sse(["done", done]),
    );
    await gatewayClient({
      fetch: fn,
      ensureSession: async (force) => {
        forced.push(force);
      },
    }).step({ messages });
    expect(forced).toEqual([false, true]);
  });

  it.each([
    [503, "quota"],
    [429, "rate_limit"],
    [409, "version"],
    [413, "invalid"],
    [502, "upstream"],
  ])("maps HTTP %s to %s", async (status, reason) => {
    const { fn } = fakeFetch(Response.json({ reason: "x" }, { status }));
    const err = await gatewayClient({ fetch: fn })
      .step({ messages })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).reason).toBe(reason);
  });

  it("treats an error event or a missing done as an upstream failure", async () => {
    for (const res of [
      sse(["text", { delta: "a" }], ["error", { reason: "provider" }]),
      sse(["text", { delta: "a" }]),
    ]) {
      const { fn } = fakeFetch(res);
      await expect(
        gatewayClient({ fetch: fn }).step({ messages }),
      ).rejects.toMatchObject({
        reason: "upstream",
      });
    }
  });
});
