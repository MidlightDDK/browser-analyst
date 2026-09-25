---
paths:
  - "web/**"
---
# Web app (Vite + React + TypeScript + Tailwind)

## Screens
- Home: headline "Drop a file. Ask a question. Watch an agent work. Your data never leaves your browser."; a sample gallery (each card: dataset + 2 questions → opens a replay); a dropzone; a "Try to hack it" card.
- Workspace (three columns on desktop, tabs on mobile). Data: tables, column profiles, virtualized preview grid. Chat: question, step cards (plan text, syntax-highlighted SQL/Python, result preview, chart), final answer with each key number linked to its result. Trace: timeline with step type, duration, tokens, provider, security flags, and CSP blocks.
- "What the model saw" drawer: the exact payload of the last step.
- Settings: approve-Python toggle, max steps; provider and model shown per step.
- Replay player: plays recorded trace events with their original timing (1×, 2×, skip), under a banner "Replay of a real run: {model}, {date}", with a "Run live" button.
- `/benchmark`: leaderboard (models × success, steps, tokens, per category), failure taxonomy, methodology. `/security`: red-team table (defenses on / off / each off).

## Loading and performance
- First paint never waits for DuckDB or Pyodide. DuckDB loads on the first file or sample; Pyodide on the first `run_python`.
- JS ≤ 300 KB gzipped before lazy chunks; Lighthouse performance ≥ 90 on Home.

## Rendering rules
Charts through vega-embed with actions off. Final answers through the sanitizer (security rule). Never signal status by color alone.

## Tests
Component tests for step cards, key-number links, and replay timing. Playwright: sample → replay plays → "Run live" (mocked gateway) → chart renders; file upload → profile; the approval gate; no CSP violations on the happy path.

