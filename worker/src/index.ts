import { PROMPT_VERSION, TOOLSET_VERSION } from "@browser-analyst/agent";
import type { Env } from "./env";
import { HttpError, json, log, rateLimit, requireMethod } from "./http";

export type { Env } from "./env";

async function route(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  switch (pathname) {
    case "/api/health":
      requireMethod(request, "GET");
      await rateLimit(env.RL_OTHER, request);
      // Which providers are configured; never secrets.
      return json({
        status: "ok",
        toolsetVersion: TOOLSET_VERSION,
        promptVersion: PROMPT_VERSION,
        providers: [
          { id: "workersAi", configured: Boolean(env.AI) },
          { id: "groq", configured: Boolean(env.GROQ_API_KEY) },
          { id: "gemini", configured: Boolean(env.GEMINI_API_KEY) },
        ],
      });
    default:
      throw new HttpError(404, "not_found");
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, pathname);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ reason: err.reason }, err.status, err.headers);
      }
      log({ route: pathname, status: 500 });
      console.error(err instanceof Error ? err.message : String(err));
      return json({ reason: "internal" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
