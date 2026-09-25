import type { ReactNode } from "react";

const SQL_KEYWORDS = new Set(
  `SELECT FROM WHERE GROUP BY ORDER HAVING LIMIT OFFSET AS AND OR NOT IN IS NULL
  JOIN LEFT RIGHT INNER OUTER FULL CROSS ON USING WITH UNION ALL DISTINCT CASE
  WHEN THEN ELSE END ASC DESC BETWEEN LIKE ILIKE OVER PARTITION QUALIFY WINDOW
  FILTER CAST TRUE FALSE EXCEPT INTERSECT VALUES NULLS FIRST LAST`.split(/\s+/),
);

const PYTHON_KEYWORDS = new Set(
  `and as assert break class continue def del elif else except False finally for
  from global if import in is lambda None nonlocal not or pass raise return True
  try while with yield`.split(/\s+/),
);

// comment | 'string' | "identifier" | number | word | anything else
const SQL_TOKEN =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+|[\s\S])/g;

// comment | string | (no quoted identifiers) | number | word | anything else
const PYTHON_TOKEN =
  /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|((?!))|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+|[\s\S])/g;

const LANGUAGES = {
  sql: {
    token: SQL_TOKEN,
    keyword: (w: string) => SQL_KEYWORDS.has(w.toUpperCase()),
  },
  python: {
    token: PYTHON_TOKEN,
    keyword: (w: string) => PYTHON_KEYWORDS.has(w),
  },
};

const CLASSES = {
  comment: "italic text-slate-500 dark:text-slate-400",
  string: "text-emerald-700 dark:text-emerald-300",
  ident: "text-sky-700 dark:text-sky-300",
  number: "text-amber-700 dark:text-amber-300",
  keyword: "font-semibold text-indigo-700 dark:text-indigo-300",
};

/** Code with lightweight syntax highlighting (text only, never HTML). */
export function Code({
  code,
  language,
}: {
  code: string;
  language: keyof typeof LANGUAGES;
}) {
  const lang = LANGUAGES[language];
  const parts: ReactNode[] = [];
  for (const m of code.matchAll(lang.token)) {
    const [text, comment, str, ident, num, word] = m;
    const cls = comment
      ? CLASSES.comment
      : str
        ? CLASSES.string
        : ident
          ? CLASSES.ident
          : num
            ? CLASSES.number
            : word && lang.keyword(word)
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

/** SQL with lightweight syntax highlighting. */
export function SqlCode({ sql }: { sql: string }) {
  return <Code code={sql} language="sql" />;
}
