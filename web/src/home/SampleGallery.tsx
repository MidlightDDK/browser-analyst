import { formatCount } from "../format";
import { SAMPLES, type Sample } from "../samples";

export function SampleGallery({
  onOpen,
}: {
  onOpen: (sample: Sample, question?: string) => void;
}) {
  return (
    <section aria-labelledby="samples-heading">
      <h2 id="samples-heading" className="text-xl font-semibold">
        Try a sample
      </h2>
      <ul className="mt-4 grid gap-4 md:grid-cols-3">
        {SAMPLES.map((s) => (
          <li
            key={s.id}
            className="flex flex-col rounded-xl border border-slate-200 p-4 dark:border-slate-800"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{s.title}</h3>
              <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-800">
                {s.format} · {formatCount(s.rows)} rows
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
              {s.description}
            </p>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Questions to ask
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {s.questions.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => onOpen(s, q)}
                    className="text-left underline decoration-dotted underline-offset-4 hover:decoration-solid"
                  >
                    <span aria-hidden="true">→ </span>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-auto flex items-center justify-between gap-2 pt-4">
              <a
                href={s.sourceUrl}
                className="text-xs text-slate-600 underline underline-offset-2 dark:text-slate-400"
              >
                Source · {s.license}
              </a>
              <button
                type="button"
                onClick={() => onOpen(s)}
                aria-label={`Open the ${s.title} sample`}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Open
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
