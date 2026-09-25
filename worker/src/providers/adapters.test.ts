import { TOOL_PAYLOAD } from "@browser-analyst/agent/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEnv, openAiResponse, USAGE_CHUNK } from "../testing";
import { gemini, groq, prepareMessages, SKIP_SIGNATURE } from "./openaiCompat";
import type { Provider, ProviderEvent, ProviderMessage } from "./types";
import { parseWorkersAi, workersAi } from "./workersAi";

afterEach(() => vi.unstubAllGlobals());

const input = {
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "q" },
  ] as ProviderMessage[],
  tools: TOOL_PAYLOAD,
};

async function collect(p: Provider, env = makeEnv()) {
  const out: ProviderEvent[] = [];
  for await (const ev of p.stream(input, env, new AbortController().signal))
    out.push(ev);
  return out;
}

const withoutProgress = (evs: ProviderEvent[]) =>
  evs.filter((e) => e.type !== "progress");

describe("OpenAI-compatible adapters", () => {
  it("assembles fragmented tool calls and maps usage (Groq)", async () => {
    const fetchMock = vi.fn(async () =>
      openAiResponse([
        { choices: [{ delta: { content: "Checking." } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "t1",
                    function: { name: "run_sql", arguments: '{"sql":' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '"SELECT 1"}' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: "t2",
                    function: { name: "list_tables", arguments: "" },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [],
          x_groq: { usage: { prompt_tokens: 7, completion_tokens: 3 } },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(withoutProgress(await collect(groq))).toEqual([
      { type: "text", delta: "Checking." },
      {
        type: "tool_call",
        call: { id: "t1", name: "run_sql", arguments: '{"sql":"SELECT 1"}' },
      },
      {
        type: "tool_call",
        call: { id: "t2", name: "list_tables", arguments: "{}" },
      },
      { type: "done", usage: { input_tokens: 7, output_tokens: 3 } },
    ]);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1]
        .body,
    );
    expect(body).toMatchObject({
      temperature: 0,
      stream: true,
      tool_choice: "auto",
    });
    expect(
      body.tools.map((t: { function: { name: string } }) => t.function.name),
    ).toContain("final_answer");
  });

  it("keeps Gemini thought signatures and tolerates a missing index", async () => {
    vi.stubGlobal("fetch", async () =>
      openAiResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: "g1",
                    function: { name: "list_tables", arguments: "{}" },
                    extra_content: { google: { thought_signature: "sig" } },
                  },
                ],
              },
            },
          ],
        },
        USAGE_CHUNK,
      ]),
    );
    const events = await collect(gemini);
    expect(events[0]).toEqual({ type: "progress" });
    expect(events[1]).toEqual({
      type: "tool_call",
      call: {
        id: "g1",
        name: "list_tables",
        arguments: "{}",
        extra_content: { google: { thought_signature: "sig" } },
      },
    });
    expect(events.at(-1)).toEqual({
      type: "done",
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  });

  it("turns Groq's tool_use_failed into a tool call the loop can reject", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json(
        {
          error: {
            code: "tool_use_failed",
            message: "Failed to call a function.",
            failed_generation: '{"name": "run_sql", "arguments": {"sql": 1}}',
          },
        },
        { status: 400 },
      ),
    );
    const [first] = await collect(groq);
    expect(first).toMatchObject({
      type: "tool_call",
      call: { name: "run_sql", arguments: '{"sql":1}' },
    });
  });

  it("throws a ProviderError with the upstream status", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("slow down", { status: 429 }),
    );
    await expect(collect(groq)).rejects.toMatchObject({ status: 429 });
  });
});

describe("prepareMessages", () => {
  const call = (id: string, sig?: string) => ({
    id,
    type: "function" as const,
    function: { name: "list_tables", arguments: "{}" },
    ...(sig ? { extra_content: { google: { thought_signature: sig } } } : {}),
  });
  const history: ProviderMessage[] = [
    { role: "assistant", content: null, tool_calls: [call("a"), call("b")] },
    { role: "assistant", content: null, tool_calls: [call("c", "real")] },
  ];

  it("adds Gemini's skip value where a signature is missing", () => {
    const [unsigned, signed] = prepareMessages(history, "gemini");
    expect(unsigned).toMatchObject({
      tool_calls: [
        {
          id: "a",
          extra_content: { google: { thought_signature: SKIP_SIGNATURE } },
        },
        { id: "b" },
      ],
    });
    expect(signed).toBe(history[1]);
  });

  it("strips extra_content for other providers", () => {
    const out = prepareMessages(history, "openai");
    expect(JSON.stringify(out)).not.toContain("extra_content");
  });
});

describe("Workers AI", () => {
  it("parses the OpenAI and legacy reply shapes", () => {
    expect(
      parseWorkersAi({
        choices: [
          {
            message: {
              content: "Plan.",
              tool_calls: [
                {
                  id: "w1",
                  function: { name: "run_sql", arguments: '{"sql":"x"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }),
    ).toEqual([
      { type: "text", delta: "Plan." },
      {
        type: "tool_call",
        call: { id: "w1", name: "run_sql", arguments: '{"sql":"x"}' },
      },
      { type: "done", usage: { input_tokens: 5, output_tokens: 1 } },
    ]);
    const legacy = parseWorkersAi({
      response: "",
      tool_calls: [{ name: "list_tables", arguments: {} }],
    });
    expect(legacy[0]).toMatchObject({
      type: "tool_call",
      call: { name: "list_tables", arguments: "{}" },
    });
  });

  it("maps binding errors to 503", async () => {
    const env = makeEnv();
    env.AI.run.mockRejectedValue(new Error("3036: daily neuron limit"));
    await expect(collect(workersAi, env)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("sends string content beside tool calls (the binding rejects null)", async () => {
    const env = makeEnv();
    env.AI.run.mockResolvedValue({ response: "ok" });
    const history: ProviderMessage[] = [
      ...input.messages,
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "a",
            type: "function",
            function: { name: "list_tables", arguments: "{}" },
            extra_content: { google: { thought_signature: "s" } },
          },
        ],
      },
      { role: "tool", tool_call_id: "a", content: "{}" },
    ];
    for await (const _ of workersAi.stream(
      { ...input, messages: history },
      env,
      new AbortController().signal,
    ));
    const sent = env.AI.run.mock.calls[0]?.[1] as {
      messages: ProviderMessage[];
    };
    expect(sent.messages[2]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "a",
          type: "function",
          function: { name: "list_tables", arguments: "{}" },
        },
      ],
    });
  });
});
