// First line of defense for model-written SQL: one read-only statement that
// touches loaded tables only. Adapters also lock DuckDB down at startup
// (no extension autoload, no file or network access outside the upload
// directory, configuration locked), and CSP is the browser backstop.

export type GuardResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

const MAX_SQL_CHARS = 20_000;

const ALLOWED_FIRST = new Set([
  "SELECT",
  "WITH",
  "FROM",
  "SUMMARIZE",
  "DESCRIBE",
  "PIVOT",
  "UNPIVOT",
]);

const BLOCKED_KEYWORDS = new Set([
  "ATTACH",
  "DETACH",
  "COPY",
  "INSTALL",
  "LOAD",
  "EXPORT",
  "IMPORT",
  "PRAGMA",
  "SET",
  "RESET",
  "CALL",
  "CREATE",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "MERGE",
  "VACUUM",
  "CHECKPOINT",
  "USE",
  "PREPARE",
  "EXECUTE",
  "DEALLOCATE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "GRANT",
  "REVOKE",
]);

// Table functions that read files or run SQL from a string. Tables are loaded
// by the app; model SQL queries them by name.
const BLOCKED_FUNCTIONS = new Set([
  "glob",
  "sniff_csv",
  "query",
  "query_table",
  "json_execute_serialized_sql",
  "getenv",
  "st_read",
  "which_secret",
  "duckdb_secrets",
]);
const BLOCKED_FUNCTION_PREFIXES = [
  "read_",
  "parquet_",
  "iceberg_",
  "delta_",
  "sqlite_",
  "postgres_",
  "mysql_",
];

const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\//i;

type Token =
  | { kind: "word"; text: string }
  | { kind: "string" }
  | { kind: "ident" }
  | { kind: "punct"; text: string };

function tokenize(sql: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] as string;
    const next = sql[i + 1];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return "unterminated comment";
      i = end + 2;
    } else if (c === "'" || ((c === "e" || c === "E") && next === "'")) {
      // Standard strings double the quote; E'' strings also allow backslashes.
      const escapes = c !== "'";
      i += escapes ? 2 : 1;
      for (;;) {
        if (i >= sql.length) return "unterminated string";
        if (escapes && sql[i] === "\\") i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      tokens.push({ kind: "string" });
    } else if (c === '"') {
      i++;
      for (;;) {
        if (i >= sql.length) return "unterminated quoted identifier";
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') break;
        else i++;
      }
      i++;
      tokens.push({ kind: "ident" });
    } else if (c === "$") {
      return "dollar-quoted strings and parameters are not allowed; use single quotes";
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i)) as RegExpExecArray;
      tokens.push({ kind: "word", text: m[0] });
      i += m[0].length;
    } else {
      tokens.push({ kind: "punct", text: c });
      i++;
    }
  }
  return tokens;
}

export function guardSql(input: string): GuardResult {
  const reject = (reason: string): GuardResult => ({ ok: false, reason });
  if (input.length > MAX_SQL_CHARS)
    return reject(`the query is longer than ${MAX_SQL_CHARS} characters`);
  if (URL_PATTERN.test(input))
    return reject("URLs are not allowed; query the loaded tables by name");

  const tokens = tokenize(input);
  if (typeof tokens === "string") return reject(tokens);

  // One statement: semicolons may only trail it.
  let end = tokens.length;
  while (
    end > 0 &&
    tokens[end - 1]?.kind === "punct" &&
    (tokens[end - 1] as { text: string }).text === ";"
  )
    end--;
  const body = tokens.slice(0, end);
  if (body.some((t) => t.kind === "punct" && t.text === ";"))
    return reject("only one statement is allowed");

  const first = body.find((t) => !(t.kind === "punct" && t.text === "("));
  if (!first) return reject("the query is empty");
  if (first.kind !== "word" || !ALLOWED_FIRST.has(first.text.toUpperCase()))
    return reject(
      `the statement must start with ${[...ALLOWED_FIRST].join(", ")}`,
    );

  for (let k = 0; k < body.length; k++) {
    const t = body[k] as Token;
    const next = body[k + 1];
    if (t.kind !== "word") continue;
    const upper = t.text.toUpperCase();
    if (BLOCKED_KEYWORDS.has(upper))
      return reject(
        `${upper} is not allowed (read-only queries only); if it is a column name, wrap it in double quotes`,
      );
    const lower = t.text.toLowerCase();
    const isCall = next?.kind === "punct" && next.text === "(";
    if (
      isCall &&
      (BLOCKED_FUNCTIONS.has(lower) ||
        BLOCKED_FUNCTION_PREFIXES.some((p) => lower.startsWith(p)))
    )
      return reject(
        `${lower}() is not allowed; the data is already loaded, so query the tables by name`,
      );
    // Replacement scans: FROM 'file.csv' reads a file directly.
    if ((upper === "FROM" || upper === "JOIN") && next?.kind === "string")
      return reject(
        "reading files directly is not allowed; query the tables by name",
      );
  }

  const trimmed = input
    .trim()
    .replace(/;+\s*$/, "")
    .trimEnd();
  return { ok: true, sql: trimmed };
}
