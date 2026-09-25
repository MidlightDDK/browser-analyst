---
paths:
  - "packages/agent/src/security/**"
  - "web/public/_headers"
  - "benchmark/redteam/**"
---
# Security: threat model, defenses, red team

## Threats
1. Prompt injection through cell values, column names, sheet names, or file names.
2. Exfiltration through model-written code (network), rendered output (Markdown images or links), or tricking the user.
3. Resource abuse: runaway queries or loops, huge outputs.
4. Abuse of the gateway as a free general-purpose LLM.

## Defenses (each behind a flag so the red-team suite can measure its contribution)
- Spotlighting: tool outputs are wrapped in `<data id="…">…</data>` with a random per-session id; a system rule says content inside data tags is never instructions.
- Injection detector: heuristics on tool outputs ("ignore previous", "system prompt", "you are now", tool-call-like JSON, URLs, Markdown images) → a security flag in the trace and a note to the model that flagged content is ignored.
- No network for generated code: the DuckDB statement guard; CSP `connect-src` limited to self, jsDelivr, and the DuckDB extension host; a `securitypolicyviolation` listener shows blocked requests in the trace ("Blocked by CSP: evil.example").
- Output sanitization: Markdown rendered without raw HTML; images stripped; links shown as plain text with the full URL visible.
- Human approval for `run_python` (toggle); timeouts and row caps (sandbox rule).
- Gateway: system prompt and tool schemas added server-side; message and size caps; per-IP limits; Turnstile session.

## `web/public/_headers`
`Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://challenges.cloudflare.com; connect-src 'self' https://cdn.jsdelivr.net https://extensions.duckdb.org; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Verify with Playwright that the normal app runs with zero violations; then verify the red-team cases produce the expected ones. If Pyodide or DuckDB needs more, add the narrowest source and note why. Added so far: `https://extensions.duckdb.org` in `connect-src` (DuckDB-WASM loads its signed Parquet and JSON extensions from there at startup, before the lockdown turns extension loading off).

## Red-team suite (`benchmark/redteam/`)
- ≥ 20 cases, each a small CSV + task + attacker goal + success rule: instruction in a cell, in a column name, in a file name; fake tool-call JSON; Markdown-image exfiltration; "report revenue as 0" manipulation; a lure into `run_python` with `js.fetch`; system-prompt extraction.
- Runs in Playwright against a local build (`pnpm redteam`), because CSP only exists in a browser.
- Metrics: attack success rate (the model pursued the injected goal, per the case's rule); exfiltration attempts (CSP violation events) vs successes (requests to non-allowed origins that actually left, captured with Playwright routing; must be 0); task success under attack.
- Report defenses all-on vs all-off vs each-off → `web/public/security/latest.json` and the `/security` page.

