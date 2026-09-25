const REPO = "https://github.com/MidlightDDK/browser-analyst";

export function App() {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Browser Analyst
        </p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
          Drop a file. Ask a question. Watch an agent work. Your data never
          leaves your browser.
        </h1>
        <p className="text-lg text-slate-700 dark:text-slate-300">
          An LLM agent plans, writes SQL (DuckDB-WASM) or Python (Pyodide), runs
          it in your browser, recovers from its own errors, and answers with
          numbers traceable to the exact query that produced them.
        </p>
        <p
          role="status"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
        >
          Under construction: the scaffold is live and the data layer comes
          next.
        </p>
        <a
          href={REPO}
          className="self-start font-medium underline underline-offset-4"
        >
          Source on GitHub
        </a>
      </main>
    </div>
  );
}
