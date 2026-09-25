// Sample question → agent run with a scripted (mocked) gateway: a SQL error,
// recovery, a verified answer, key-number evidence, the trace, and the
// "What the model saw" drawer. The SQL itself runs in the page's DuckDB.
import { expect, type Route, test } from "@playwright/test";
import { trackErrors } from "./errors";

const QUESTION = "Which species has the heaviest average body mass?";
const GOOD_SQL =
  "SELECT species, round(avg(body_mass_g), 1) AS mean_mass FROM penguins GROUP BY species ORDER BY mean_mass DESC";

const sse = (events: [string, unknown][]) =>
  events
    .map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
    .join("");

const done = (n: number) => [
  "done",
  {
    usage: { input_tokens: 1000 + n, output_tokens: 50 },
    provider: "mock",
    model: "scripted-model",
    latencyMs: 5,
  },
];

const call = (id: string, name: string, args: unknown) => [
  "tool_call",
  { id, name, arguments: JSON.stringify(args) },
];

const SCRIPT = [
  sse([
    ["text", { delta: "I'll average body mass per species." }],
    call("a", "run_sql", {
      sql: "SELECT species, avg(mass) FROM penguins GROUP BY 1",
      purpose: "mean mass by species",
    }),
    done(1),
  ] as [string, unknown][]),
  sse([
    ["text", { delta: "The column is body_mass_g; retrying." }],
    call("b", "run_sql", { sql: GOOD_SQL, purpose: "mean mass by species" }),
    done(2),
  ] as [string, unknown][]),
  sse([
    call("c", "final_answer", {
      answer_markdown:
        "**Gentoo** penguins are the heaviest, at about 5,076 g on average.",
      key_numbers: [
        {
          label: "Gentoo mean body mass (g)",
          value: 5076,
          result_id: "r1",
          column: "mean_mass",
          row: 0,
        },
      ],
      caveats: ["Two penguins have no recorded body mass."],
    }),
    done(3),
  ] as [string, unknown][]),
];

test("a sample question runs through the agent to a verified answer", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = {
        render(el, o) { setTimeout(() => o.callback("mock-token")); return "w"; },
        remove() {},
      };`,
    }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { expiresAt: Date.now() + 1_800_000 } }),
  );
  const bodies: { messages: { role: string; content: string | null }[] }[] = [];
  await page.route("**/api/agent/step", (route: Route) => {
    bodies.push(route.request().postDataJSON());
    const body = SCRIPT[bodies.length - 1];
    return body
      ? route.fulfill({ contentType: "text/event-stream", body })
      : route.fulfill({ status: 503, json: { reason: "quota" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: QUESTION }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "penguins" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByLabel("Your question")).toHaveValue(QUESTION);
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  const answer = page.getByRole("region", { name: "Answer" });
  await expect(answer).toContainText("Gentoo penguins are the heaviest", {
    timeout: 30_000,
  });
  await expect(answer).toContainText("✓ matches r1.mean_mass row 0");
  await expect(answer).not.toContainText("didn’t match");

  // Step 1 failed in DuckDB and the model saw the error; step 2 recovered.
  const step1 = page.getByRole("article", { name: "Step 1" });
  await expect(step1).toContainText("Error:");
  await expect(step1).toContainText("mass");
  expect(JSON.stringify(bodies[1]?.messages.at(-1))).toContain("Binder Error");
  await expect(page.getByRole("article", { name: "Step 2" })).toContainText(
    "r1 · 3 rows",
  );

  // Only schemas and previews reach the model: the catalog, not the data.
  const first = bodies[0]?.messages[0]?.content ?? "";
  expect(first).toContain("Table penguins: 344 rows");
  expect(first).toContain(`Question: ${QUESTION}`);

  await answer.getByRole("button", { name: /Gentoo mean body mass/ }).click();
  await expect(answer.getByLabel("cited: 5076")).toBeVisible();
  await expect(answer.locator("pre")).toContainText(
    "round(avg(body_mass_g), 1)",
  );

  const trace = page.getByRole("list", { name: `Trace of: ${QUESTION}` });
  await expect(trace.getByRole("listitem")).toHaveCount(7);
  await expect(trace).toContainText("scripted-model");

  await page.getByRole("button", { name: "What the model saw" }).click();
  const drawer = page.getByRole("dialog", { name: "What the model saw" });
  await expect(drawer).toContainText("Sent from your browser in the last step");
  await expect(drawer).toContainText("Added by the gateway: system prompt");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();

  expect(errors).toEqual([]);
});

test("an exhausted quota shows a friendly message, not an error", async ({
  page,
}) => {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback("t")); return "w"; }, remove() {} };`,
    }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { expiresAt: Date.now() + 1_800_000 } }),
  );
  await page.route("**/api/agent/step", (route) =>
    route.fulfill({ status: 503, json: { reason: "quota" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: QUESTION }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "penguins" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "quota" }),
  ).toContainText("The free AI quota is used up for now");
});
