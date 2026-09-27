# Browser Analyst roadmap
One milestone at a time. Start each with an ≤ 8-line plan and wait for approval; end with the 5-line report. A milestone is done only when every acceptance box passes; then tick it in CLAUDE.md.

## M0: Scaffold + hello-world deploy
- If CLAUDE.md still contains the reference sections, run the first-run split.
- pnpm workspace (`web`, `worker`, `packages/agent`, `benchmark`); strict TypeScript base config; ESLint + Prettier (or Biome; pick one and note why); vitest; Playwright (chromium only).
- Files: `.gitignore` and `.claude/settings.json` exactly as below; `web/public/_headers` from the security rule; `LICENSE` (MIT); `README.md` stub; `worker/dev.vars.example` (names only); root `package.json` scripts matching the Commands section (stubs printing "not implemented" are fine until their milestone).
- Worker serving a placeholder SPA page plus `GET /api/health`. `pnpm dev` runs `vite` and `wrangler dev` together with Vite proxying `/api`, or uses the Cloudflare Vite plugin; pick one and note why.
- `ci.yml`: install, lint, typecheck, unit tests, build.
- First deploy: the user runs `wrangler login`; Claude runs `pnpm run deploy` after approval.
Acceptance:
- [x] `https://browser-analyst.<account-subdomain>.workers.dev` shows the placeholder and `/api/health` returns JSON.
- [x] `curl -sI <live-url> | grep -i content-security-policy` shows the policy.
- [x] CI is green on a PR; `git ls-files | grep -E '(^|/)(\.env|\.dev\.vars)$'` prints nothing.

`.gitignore`:
```gitignore
node_modules/
dist/
.wrangler/
coverage/
playwright-report/
test-results/
.env
.env.*
.dev.vars
CLAUDE.local.md
.claude/settings.local.json
HANDOFF.md
benchmark/data/
benchmark/results/
benchmark/.cache/
*.log
.DS_Store
```

`.claude/settings.json` (strict JSON, no comments):
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/.env)",
      "Read(./**/.env.*)",
      "Read(./**/.dev.vars)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git push * --force)"
    ],
    "ask": [
      "Bash(git push)",
      "Bash(git push *)",
      "Bash(pnpm run deploy)",
      "Bash(pnpm run deploy *)",
      "Bash(npx wrangler deploy)",
      "Bash(npx wrangler deploy *)"
    ]
  }
}
```

## M1: Data layer (files → DuckDB-WASM → profiles)
- DuckDB-WASM worker; ingestion of CSV/TSV/Parquet/JSON plus XLSX via SheetJS CE; column profiles; virtualized preview grid; three sample datasets in the gallery; SQL guard and timeout; the Node twin for SQL.
Acceptance:
- [x] A 50 MB CSV loads and profiles; measured time reported (target < 5 s).
- [x] SQL-guard unit tests cover ≥ 20 allowed and rejected statements.
- [x] Browser and Node adapters pass the shared contract tests for SQL.

## M2: Agent core + gateway + chat/trace UI
- `packages/agent` loop with `list_tables`, `describe_table`, `run_sql`, `ask_user`, `final_answer`; result store; context compaction; prompts. `/api/agent/step` with the provider chain and tool normalization (reused from FilingLens when available). Chat, trace, and "What the model saw" UI.
Acceptance:
- [x] Five sample questions solved live end to end.
- [x] `final_answer` validation catches a planted wrong number (test).
- [x] Loop tests pass (recovery, step cap, repeated failure, invalid arguments, `ask_user`).
- [x] At least 2 providers pass the tool-calling contract test.

## M3: Charts + Python sandbox + approvals
- `make_chart` (vega-embed), `run_python` (lazy Pyodide worker, timeout, approval gate), the Node twin for Python.
Acceptance:
- [x] Chart tasks render from result ids, and an e2e test confirms no chart data appears in the model payload.
- [x] An infinite loop in Python is killed at 15 s and the agent recovers.
- [x] The approval gate blocks execution until clicked.

## M4: Benchmark v1 + CI gate
- `datasets.json` with download and verification; `tasks.jsonl` with reference SQL (all reviewed by the user); `bench:expected`; the Node harness; scorers; report; baseline; CI smoke gate with PR comment.
Acceptance:
- [x] About 100 reviewed tasks covering every category. (2026-09-26: reviewed by Claude, which the user delegated: all 100 reference queries re-run on the data; no ties in the top-1 tasks; messy-data normalizations verified (no blank strings, every date parses in the three formats); the impossible tasks confirmed unanswerable, e.g. owid_co2 has no methane column. No task needed a change.)
- [x] Per-category baseline for one model committed in `benchmark/baseline.json`. (2026-09-27: gemini-3.5-flash-lite, the live app's first model: 94/100, smoke 14/15.)
- [x] The gate proven by a deliberately broken branch (then reverted). (2026-09-27: PR #9 made the prompt ask before every query; unit tests passed, smoke fell to 8/15 (53.3%) against the 88.3% floor, and `bench-smoke` failed and commented (run 36311656584); closed unmerged and the branch deleted. Main's first gated run: 15/15.)

## M5: Security defenses + red-team suite
- Detector, spotlighting, sanitizer, CSP-violation surfacing, defense flags, ≥ 20 red-team cases, the "Try to hack it" card, and the `/security` page.
Acceptance:
- [x] Red-team table for all-on, all-off, and each-off, with attack success rate and task success under attack. (2026-09-26: gemini-3.5-flash-lite, 0/24 attacks and 25/25 tasks in all 7 configurations; on /security and in the README.)
- [x] Zero exfiltration successes with CSP on (Playwright-verified); blocked attempts visible in the trace. (Hijacked model: 0 requests left with CSP on in all 5 CSP-on configurations; 3 with CSP off, 4 with everything off.)

## M6: Leaderboard, replays, examples
- At least 3 models benchmarked; `/benchmark` page; replay recorder and player; every sample card plays a replay with "Run live".
Acceptance:
- [x] Leaderboard live with ≥ 3 models and per-category results. (2026-09-27: gemini-3.5-flash-lite 94%, gemini-3.1-flash-lite 94%, gemma-4-26b-a4b-it 88%.)
- [x] Replays work when every provider is down. (`web/e2e/replay.e2e.ts` against the live site, version 9227da35: every step answers 503, the recording still plays, and the quota message offers it.)

## M7: Polish + launch
- README (outline below), architecture diagram (Mermaid in the README), performance-budget and mobile pass, `smoke.yml`, final benchmark and red-team numbers in the README.
Acceptance:
- [x] README complete with release numbers committed. (2026-09-25: README follows the outline, with a Mermaid diagram, results, performance, and methodology; 2026-09-26: live-model red-team rates added; 2026-09-27: gemini-3.5-flash-lite benchmark row added.)
- [ ] Smoke workflow green for 3 consecutive days. (`.github/workflows/smoke.yml`, daily at 05:23 UTC; first run green on 2026-09-25, run 36199472966.)
- [x] Demo video linked at the top of the README. (2026-09-26: made by Claude at the user's request from scripted recordings of the live site; the live "Try to hack it" run is one gemini-3.5-flash-lite run on production; 65 s, captioned; GitHub inline player plus https://youtu.be/ECeh_A207S0, unlisted.)

## Stretch (only when the user asks)
- `packages/mcp-server`: a stdio MCP server built with `@modelcontextprotocol/sdk` exposing `list_tables`, `describe_table`, and `run_sql` over local files via `@duckdb/node-api`; publish to npm only if the user wants.
- Tier-0 local SQL model from the PocketSQL project: try the local model first, escalate to the LLM agent when its SQL fails validation; report % answered locally, the accuracy change, and API calls saved.

## README outline (recruiter-first)
1. One-line pitch, live link, 60-second video/GIF.
2. Results: benchmark success by model and category, self-repair rate, provenance-valid rate, red-team attack success on vs off, exfiltration successes (0).
3. How it works (diagram): code runs in your browser; "Runs for $0" box.
4. Design decisions and tradeoffs, each with evidence (results by reference, in-browser sandbox, CSP egress control, spotlighting).
5. What didn't work.
6. Benchmark and red-team methodology.
7. Run locally.
8. Dataset licenses, privacy, limitations.
