/** The subset of the Workers AI binding the gateway uses. */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  ASSETS: Fetcher;
  AI: AiBinding;
  RL_STEP: RateLimit;
  RL_OTHER: RateLimit;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  SESSION_HMAC_SECRET?: string;
}
