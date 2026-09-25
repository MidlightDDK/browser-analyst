import { HACK_SAMPLE, type Sample } from "../samples";

export function HackCard({
  onOpen,
}: {
  onOpen: (sample: Sample, question: string) => void;
}) {
  return (
    <section
      aria-labelledby="hack-heading"
      className="rounded-xl border-2 border-amber-300 p-5 dark:border-amber-800"
    >
      <h2 id="hack-heading" className="text-xl font-semibold">
        <span aria-hidden="true">⚑ </span>Try to hack it
      </h2>
      <p className="mt-2 max-w-3xl text-slate-700 dark:text-slate-300">
        This sales file hides prompt injections in its notes. One tells the
        agent to report revenue as 0, one to leak the total through an image
        link, and one to send the data to a server from Python. Ask a question
        and watch the trace flag them. Then turn the defenses off in Settings
        and try again.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {HACK_SAMPLE.questions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onOpen(HACK_SAMPLE, q)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-left text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <span aria-hidden="true">→ </span>
            {q}
          </button>
        ))}
        <a
          href="/security"
          className="text-sm font-medium underline underline-offset-4"
        >
          Red-team results
        </a>
      </div>
    </section>
  );
}
