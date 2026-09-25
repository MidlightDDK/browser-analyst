// A scripted gateway for Playwright: the bot check, the session, and one
// model step per script entry (then a quota 503).
import type { Page } from "@playwright/test";

export type Body = { messages: { role: string; content: string | null }[] };

const sse = (events: [string, unknown][]) =>
  events
    .map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
    .join("");

export const step = (name: string, args: unknown, n: number) =>
  sse([
    ["tool_call", { id: `t${n}`, name, arguments: JSON.stringify(args) }],
    [
      "done",
      {
        usage: { input_tokens: 1000, output_tokens: 50 },
        provider: "mock",
        model: "scripted-model",
        latencyMs: 5,
      },
    ],
  ]);

/** Mocks the bot check and session, and plays `script` as model steps. */
export async function mockGateway(page: Page, script: [string, unknown][]) {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback("t")); return "w"; }, remove() {} };`,
    }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { expiresAt: Date.now() + 1_800_000 } }),
  );
  const bodies: Body[] = [];
  await page.route("**/api/agent/step", (route) => {
    bodies.push(route.request().postDataJSON());
    const next = script[bodies.length - 1];
    return next
      ? route.fulfill({
          contentType: "text/event-stream",
          body: step(next[0], next[1], bodies.length),
        })
      : route.fulfill({ status: 503, json: { reason: "quota" } });
  });
  return bodies;
}
