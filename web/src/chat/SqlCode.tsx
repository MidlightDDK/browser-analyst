import type { ReactNode } from "react";

const KEYWORDS = new Set(
  `SELECT FROM WHERE GROUP BY ORDER HAVING LIMIT OFFSET AS AND OR NOT IN IS NULL
  JOIN LEFT RIGHT INNER OUTER FULL CROSS ON USING WITH UNION ALL DISTINCT CASE
  WHEN THEN ELSE END ASC DESC BETWEEN LIKE ILIKE OVER PARTITION QUALIFY WINDOW
  FILTER CAST TRUE FALSE EXCEPT INTERSECT VALUES NULLS FIRST LAST`.split(/\s+/),
);

// comment | 'string' | "identifier" | number | word | anything else
const TOKEN =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+|[\s\S])/g;

const CLASSES = {
  comment: "italic text-slate-500 dark:text-slate-400",
  string: "text-emerald-700 dark:text-emerald-300",
  ident: "text-sky-700 dark:text-sky-300",
  number: "text-amber-700 dark:text-amber-300",
  keyword: "font-semibold text-indigo-700 dark:text-indigo-300",
};

/** SQL with lightweight syntax highlighting (text only, never HTML). */
export function SqlCode({ sql }: { sql: string }) {
  const parts: ReactNode[] = [];
  for (const m of sql.matchAll(TOKEN)) {
    const [text, comment, str, ident, num, word] = m;
    const cls = comment
      ? CLASSES.comment
      : str
        ? CLASSES.string
        : ident
          ? CLASSES.ident
          : num
            ? CLASSES.number
            : word && KEYWORDS.has(word.toUpperCase())
              ? CLASSES.keyword
              : undefined;
    parts.push(
      cls ? (
        <span key={m.index} className={cls}>
          {text}
        </span>
      ) : (
        text
      ),
    );
  }
  return (
    <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 dark:bg-slate-900 dark:text-slate-200">
      <code>{parts}</code>
    </pre>
  );
}
