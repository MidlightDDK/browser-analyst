import { useState } from "react";
import { useAgent } from "./agent/useAgent";
import { type PendingFile, useDataSession } from "./data/useDataSession";
import { Dropzone } from "./home/Dropzone";
import { SampleGallery } from "./home/SampleGallery";
import type { Sample } from "./samples";
import { Workspace } from "./workspace/Workspace";

const REPO = "https://github.com/MidlightDDK/browser-analyst";

function sampleFile(sample: Sample): PendingFile {
  return {
    name: sample.file,
    read: async () => {
      const res = await fetch(`/samples/${sample.file}`);
      if (!res.ok)
        throw new Error(
          `Couldn’t download the ${sample.title} sample (${res.status})`,
        );
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

export function App() {
  const session = useDataSession();
  const agent = useAgent(session);
  const [view, setView] = useState<"home" | "workspace">("home");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const open = (files: PendingFile[], sample?: Sample, question = "") => {
    setView("workspace");
    if (sample) setSuggestions(sample.questions);
    setDraft(question);
    void session.addFiles(files);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {view === "workspace" ? (
        <Workspace
          tables={session.tables}
          phase={session.phase}
          engine={session.engine}
          onFiles={(files) => void session.addFiles(files)}
          onHome={() => setView("home")}
          tableRows={session.tableRows}
          agent={agent}
          suggestions={suggestions}
          draft={draft}
          getResult={(id) => session.sandbox?.getResult(id)}
        />
      ) : (
        <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12 sm:py-16">
          <header className="max-w-3xl space-y-5">
            <p className="text-sm font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
              Browser Analyst
            </p>
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
              Drop a file. Ask a question. Watch an agent work. Your data never
              leaves your browser.
            </h1>
            <p className="text-lg text-slate-700 dark:text-slate-300">
              An LLM agent plans, writes SQL (DuckDB-WASM) or Python (Pyodide),
              runs it in your browser, recovers from its own errors, and answers
              with numbers traceable to the exact query that produced them.
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Only schemas, profiles, and previews of at most 20 rows reach the
              model.{" "}
              <a
                href={REPO}
                className="font-medium underline underline-offset-4"
              >
                Source on GitHub
              </a>
            </p>
          </header>
          <SampleGallery
            onOpen={(s, question) => open([sampleFile(s)], s, question)}
          />
          <Dropzone onFiles={open} />
          {session.tables.length > 0 && (
            <button
              type="button"
              onClick={() => setView("workspace")}
              className="self-start font-medium underline underline-offset-4"
            >
              Back to your{" "}
              {session.tables.length === 1
                ? "table"
                : `${session.tables.length} tables`}
            </button>
          )}
        </main>
      )}
    </div>
  );
}
