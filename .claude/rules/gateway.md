---
paths:
  - "worker/**"
---
# Worker + agent-step gateway (Cloudflare Workers, TypeScript)

## Reuse first
Ask the user for the local path of the FilingLens repo. If it exists, copy its `worker/src/providers/`, session, and rate-limit modules (read only those directories) and adapt them. Otherwise build from this spec.

## Platform facts (Workers Free) that shape the design
- 100k requests/day; 10 ms CPU per request (time spent awaiting fetch doesn't count); 50 subrequests per request; 3 MB script. Keep the Worker thin: validate → limit → add system prompt and tools → stream.
- One Worker serves the SPA: `assets.directory "../web/dist"`, `not_found_handling "single-page-application"`, `binding "ASSETS"`, `run_worker_first ["/api/*"]` (needs Wrangler ≥ 4.20).
- Workers AI goes through binding `AI` (no key; 10k free neurons/day shared by all models). Providers retire models, so model IDs live only in `providers.config.ts`.

## `worker/wrangler.jsonc`
Assets as above, `ai: {binding: "AI"}`, `ratelimits`: `RL_STEP` (20 per 60 s) and `RL_OTHER` (30 per 60 s). The rate-limit binding counts per Cloudflare location and is approximate, which is fine here.

## API (zod-validated, same-origin only via an Origin check)
- `POST /api/session {turnstileToken}` → HMAC-signed session (30 min) in an HttpOnly, Secure, SameSite=Strict cookie.
- `POST /api/agent/step {messages[], toolsetVersion, promptVersion}` → SSE of normalized events: `text {delta}`, `tool_call {id, name, arguments}`, `done {usage, provider, model, latencyMs}`, `error {reason}`. The Worker prepends the system prompt and tool schemas imported from `packages/agent`; if the versions don't match, return 409. Caps: ≤ 24 messages, ≤ 24 KB total, each tool message ≤ 4 KB, `max_tokens` 800, `temperature` 0.
- `GET /api/health` → which providers are currently usable; never secrets.

## Providers (`worker/src/providers/`)
- Configurable order. Each adapter declares `supportsTools`; only tool-capable providers join the agent chain. Normalize tool calls to OpenAI style `{id, name, arguments (JSON string)}`. Invalid JSON arguments become a tool error the model can fix.
- Fall through on 429, 5xx, or no first token within 8 s; mark that provider cold for 60 s (in-memory, best effort). If all fail → `503 {reason: "quota"}`; the UI offers replays.
- Contract test per provider (`pnpm test:providers`, needs keys; run manually or nightly): one tool-call round trip.
- Look up current endpoints and free model IDs once; record them with doc URLs in `providers.config.ts`.
- Log only `{route, provider, status, latencyMs, tokens, steps}`; never message content.

## Tests (vitest; mock fetch and bindings)
Fallback order, SSE and tool-call normalization per provider, version mismatch 409, caps, session paths, Origin rejection, rate-limit 429.

