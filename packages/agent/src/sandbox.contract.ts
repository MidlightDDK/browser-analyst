// Shared contract for Sandbox adapters. The Node twin runs it in vitest
// (benchmark/src/adapters/duckdb-node.test.ts); the browser adapter runs it in
// Chromium through web/contract.html (web/e2e/sandbox-contract.e2e.ts).
// Cases run in order against one sandbox and depend on earlier registrations.
// Plain assertions (no test framework) so the same code runs in both places.

import type { Cell, Sandbox, SqlResult, SqlSuccess } from "./sandbox.ts";

export interface ContractCase {
  name: string;
  run(sandbox: Sandbox): Promise<void>;
}

function eq(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

function check(condition: boolean, what: string): void {
  if (!condition) throw new Error(what);
}

function success(r: SqlResult, what: string): SqlSuccess {
  if ("error" in r) throw new Error(`${what}: unexpected error: ${r.error}`);
  return r;
}

function failure(r: SqlResult, pattern: RegExp, what: string): void {
  if (!("error" in r))
    throw new Error(
      `${what}: expected an error, got ${JSON.stringify(r.preview)}`,
    );
  check(
    pattern.test(r.error),
    `${what}: error ${JSON.stringify(r.error)} does not match ${pattern}`,
  );
  check(r.error.length <= 500, `${what}: error longer than 500 chars`);
}

async function rows(sb: Sandbox, sql: string): Promise<Cell[][]> {
  return success(await sb.sql(sql), sql).preview;
}

async function rejects(
  p: Promise<unknown>,
  pattern: RegExp,
  what: string,
): Promise<void> {
  try {
    await p;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(
      pattern.test(message),
      `${what}: error ${JSON.stringify(message)} does not match ${pattern}`,
    );
    return;
  }
  throw new Error(`${what}: expected a rejection`);
}

const text = (s: string) => new TextEncoder().encode(s);
const LONG_BIO =
  "Mathematician and writer who described the first published algorithm for a machine.";

export const FIXTURES = {
  people: text(
    `id,name,city,score,joined,bio\n1,Ada,Paris,91.5,2024-01-02,${LONG_BIO}\n2,Bo,Lyon,78,2024-02-10,\n3,Cy,Paris,,2024-03-15,short\n4,Di,Nice,88.25,2024-04-01,x\n5,Ed,Paris,65,2024-05-20,y\n6,Fa,Lyon,70.5,,z\n`,
  ),
  sales: text(
    "region\tmonth\trevenue\nNorth\t2024-01\t1200.5\nSouth\t2024-01\t800\nNorth\t2024-02\t1300.25\n",
  ),
  events: text(
    JSON.stringify([
      { user: "a", event: "click", ts: "2024-01-01 10:00:00", value: 1 },
      { user: "b", event: "view", ts: "2024-01-01 11:30:00", value: 3 },
      { user: "a", event: "view", ts: "2024-01-02 09:15:00", value: 2 },
    ]),
  ),
  logs: text('{"level":"info","ms":12}\n{"level":"error","ms":340}\n'),
  weird: text('"Total Sales ($)",select,"a ""quoted"" name"\n10,x,1\n20,y,2\n'),
  // orders(order_id, product, qty, unit_price, sold_on DATE), 4 rows, written by DuckDB.
  orders: Uint8Array.from(
    atob(
      "UEFSMRUAFSwVLCwVCBUAFQYVBgAAAgAAAAgBAQAAAAIAAAADAAAABAAAABUAFWIVYiwVCBUAFQYVBgAAAgAAAAgBBgAAAHdpZGdldAYAAABnYWRnZXQGAAAAd2lkZ2V0CQAAAGRvb2hpY2tleRUAFSwVLCwVCBUAFQYVBgAAAgAAAAgBAwAAAAEAAAACAAAABQAAABUAFSwVLCwVCBUAFQYVBgAAAgAAAAgB+gAAAOgDAAD6AAAAfQAAABUAFWIVYiwVCBUAFQYVBgAAIQAAAEEHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEdNAABITQAAS00AABUCGWw1ABgNZHVja2RiX3NjaGVtYRUKABUCJQIYCG9yZGVyX2lkJSIAFQwlAhgHcHJvZHVjdCUAABUCJQIYA3F0eSUiABUCJQIYCnVuaXRfcHJpY2UlChUEFQgsXBUEFQgAAAAVAiUCGAdzb2xkX29uJQwAFggZHBlcJgAcFQIZFQAZGAhvcmRlcl9pZBUAFggWThZOJgg8GAQEAAAAGAQBAAAAFgAoBAQAAAAYBAEAAAAREQAAACYAHBUMGRUAGRgHcHJvZHVjdBUAFggWhAEWhAEmVjwYBndpZGdldBgJZG9vaGlja2V5FgAoBndpZGdldBgJZG9vaGlja2V5EREAAAAmABwVAhkVABkYA3F0eRUAFggWThZOJtoBPBgEBQAAABgEAQAAABYAKAQFAAAAGAQBAAAAEREAAAAmABwVAhkVABkYCnVuaXRfcHJpY2UVABYIFk4WTiaoAjwYBOgDAAAYBH0AAAAWACgE6AMAABgEfQAAABERAAAAJgAcFQIZFQAZGAdzb2xkX29uFQAWCBaEARaEASb2AjwYBEtNAAAYBEdNAAAWAigES00AABgER00AABERAAAAFvIDFggmCBbyAwAoKER1Y2tEQiB2ZXJzaW9uIHYxLjUuNCAoYnVpbGQgMDhlMzRjNDQ3YikZXBwAABwAABwAABwAABwAAAACAgAAUEFSMQ==",
    ),
    (c) => c.charCodeAt(0),
  ),
};

/** Two data sheets (one with Excel date serials) and an empty one. */
async function budgetXlsx(): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const plan = XLSX.utils.aoa_to_sheet([
    ["dept", "month", "amount"],
    ["Ops", 45292, 100],
    ["Ops", 45323, 120],
    ["IT", 45292, 80],
  ]);
  for (const ref of ["B2", "B3", "B4"]) plan[ref].z = "yyyy-mm-dd";
  const actuals = XLSX.utils.aoa_to_sheet([
    ["dept", "amount"],
    ["Ops", 95.5],
    ["IT", 90],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, plan, "Plan");
  XLSX.utils.book_append_sheet(wb, actuals, "Actuals");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Notes");
  return new Uint8Array(
    XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  );
}

export const contractCases: ContractCase[] = [
  {
    name: "registers CSV, TSV, JSON, NDJSON, and Parquet files",
    async run(sb) {
      const loaded = [
        ...(await sb.registerFile("people.csv", FIXTURES.people)),
        ...(await sb.registerFile("Sales Q1 (final).tsv", FIXTURES.sales)),
        ...(await sb.registerFile("events.json", FIXTURES.events)),
        ...(await sb.registerFile("logs.jsonl", FIXTURES.logs)),
        ...(await sb.registerFile("orders.parquet", FIXTURES.orders)),
      ];
      eq(
        loaded.map((t) => [t.table, t.rows, t.columns, t.format]),
        [
          ["people", 6, 6, "csv"],
          ["sales_q1_final", 3, 3, "tsv"],
          ["events", 3, 4, "json"],
          ["logs", 2, 2, "json"],
          ["orders", 4, 5, "parquet"],
        ],
        "registered tables",
      );
      check(
        loaded.every((t) => t.loadMs >= 0),
        "loadMs is set",
      );
    },
  },
  {
    name: "registers each non-empty spreadsheet sheet as a table with ISO dates",
    async run(sb) {
      const loaded = await sb.registerFile(
        "Budget 2024.xlsx",
        await budgetXlsx(),
      );
      eq(
        loaded.map((t) => [t.table, t.rows, t.columns, t.format, t.source]),
        [
          ["budget_2024_plan", 3, 3, "csv", "Budget 2024.xlsx › Plan"],
          ["budget_2024_actuals", 2, 2, "csv", "Budget 2024.xlsx › Actuals"],
        ],
        "sheets",
      );
      const r = success(
        await sb.sql(
          "SELECT month, sum(amount) AS total FROM budget_2024_plan GROUP BY month ORDER BY month",
        ),
        "plan totals",
      );
      eq(r.columns[0], { name: "month", type: "DATE" }, "month column");
      eq(
        r.preview,
        [
          ["2024-01-01", 180],
          ["2024-02-01", 120],
        ],
        "plan totals",
      );
    },
  },
  {
    name: "derives safe, unique table names and rejects unknown formats",
    async run(sb) {
      const one = text("a\n1\n");
      const names = [
        ...(await sb.registerFile("people.csv", one)),
        ...(await sb.registerFile("2024.csv", one)),
        ...(await sb.registerFile("Café Menü.csv", one)),
        ...(await sb.registerFile("select.csv", one)),
        ...(await sb.registerFile("weird.csv", FIXTURES.weird)),
      ].map((t) => t.table);
      eq(
        names,
        ["people_2", "t_2024", "cafe_menu", "t_select", "weird"],
        "table names",
      );
      await rejects(
        sb.registerFile("notes.txt", one),
        /Unsupported file type/,
        "notes.txt",
      );
    },
  },
  {
    name: "lists tables sorted by name with row and column counts",
    async run(sb) {
      const tables = await sb.listTables();
      eq(
        tables.map((t) => t.table),
        [...tables.map((t) => t.table)].sort(),
        "sorted",
      );
      eq(
        tables.find((t) => t.table === "people"),
        { table: "people", rows: 6, columns: 6 },
        "people",
      );
    },
  },
  {
    name: "describes a table from SUMMARIZE with top values and 3 truncated sample rows",
    async run(sb) {
      const p = await sb.describe("people");
      eq(p.rows, 6, "rows");
      eq(
        p.columns.map((c) => [c.name, c.type]),
        [
          ["id", "BIGINT"],
          ["name", "VARCHAR"],
          ["city", "VARCHAR"],
          ["score", "DOUBLE"],
          ["joined", "DATE"],
          ["bio", "VARCHAR"],
        ],
        "types",
      );
      const score = p.columns[3];
      eq(
        [score?.null_pct, score?.min, score?.max],
        [16.67, 65, 91.5],
        "score stats",
      );
      eq(p.columns[4]?.min, "2024-01-02", "joined min");
      eq(
        p.columns[2]?.top_values,
        ["Paris", "Lyon", "Nice"],
        "city top values",
      );
      eq(
        p.columns[0]?.top_values,
        [],
        "no top values for a unique number column",
      );
      eq(p.sample_rows.length, 3, "sample rows");
      eq(
        p.sample_rows[0]?.slice(0, 5),
        [1, "Ada", "Paris", 91.5, "2024-01-02"],
        "first sample row",
      );
      eq(String(p.sample_rows[0]?.[5]).length, 60, "bio cut to 60 chars");
      await rejects(sb.describe("missing"), /Unknown table/, "unknown table");
    },
  },
  {
    name: "describes tables whose column names need quoting",
    async run(sb) {
      const p = await sb.describe("weird");
      eq(
        p.columns.map((c) => c.name),
        ["Total Sales ($)", "select", 'a "quoted" name'],
        "names",
      );
      eq(
        await rows(sb, 'SELECT sum("Total Sales ($)") AS s FROM weird'),
        [[30]],
        "quoted sum",
      );
    },
  },
  {
    name: "runs an aggregate with canonical types and values",
    async run(sb) {
      const r = success(
        await sb.sql(
          "SELECT city, count(*) AS n, round(avg(score), 2) AS avg_score FROM people GROUP BY city ORDER BY n DESC, city",
        ),
        "aggregate",
      );
      eq(
        r.columns,
        [
          { name: "city", type: "VARCHAR" },
          { name: "n", type: "BIGINT" },
          { name: "avg_score", type: "DOUBLE" },
        ],
        "columns",
      );
      eq(
        r.preview,
        [
          ["Paris", 3, 78.25],
          ["Lyon", 2, 74.25],
          ["Nice", 1, 88.25],
        ],
        "rows",
      );
      eq([r.row_count, r.truncated], [3, false], "counts");
      check(/^r\d+$/.test(r.result_id), "result id format");
      check(r.elapsed_ms >= 0, "elapsed_ms");
    },
  },
  {
    name: "normalizes dates, timestamps, big integers, decimals, lists, and structs",
    async run(sb) {
      const r = success(
        await sb.sql(
          "SELECT DATE '2024-01-02' AS d, TIMESTAMP '2024-01-02 03:04:05' AS ts, TIMESTAMP '2024-01-02 03:04:05.250' AS ts_ms, 12345678901::BIGINT AS big, 1.25::DECIMAL(5,2) AS dec, sum(x) AS hs, true AS flag, NULL::VARCHAR AS nothing, [1, 2] AS list, {'k': 'v'} AS obj FROM (VALUES (1::BIGINT), (2)) t(x)",
        ),
        "types",
      );
      eq(
        r.columns.map((c) => c.type),
        [
          "DATE",
          "TIMESTAMP",
          "TIMESTAMP",
          "BIGINT",
          "DOUBLE",
          "DOUBLE",
          "BOOLEAN",
          "VARCHAR",
          "LIST",
          "STRUCT",
        ],
        "type labels",
      );
      eq(
        r.preview[0],
        [
          "2024-01-02",
          "2024-01-02 03:04:05",
          "2024-01-02 03:04:05.250",
          12345678901,
          1.25,
          3,
          true,
          null,
          "[1,2]",
          '{"k":"v"}',
        ],
        "values",
      );
    },
  },
  {
    name: "reads TSV, JSON, Parquet, and spreadsheet tables with SQL",
    async run(sb) {
      eq(
        await rows(
          sb,
          "SELECT sum(revenue) FROM sales_q1_final WHERE region = 'North'",
        ),
        [[2500.75]],
        "tsv",
      );
      eq(
        await rows(sb, "SELECT typeof(ts), sum(value) FROM events GROUP BY 1"),
        [["TIMESTAMP", 6]],
        "json",
      );
      eq(
        await rows(sb, "SELECT max(ms) FROM logs WHERE level = 'error'"),
        [[340]],
        "ndjson",
      );
      eq(
        await rows(
          sb,
          "SELECT sum(qty * unit_price), count(sold_on) FROM orders",
        ),
        [[28.75, 3]],
        "parquet",
      );
      eq(
        await rows(
          sb,
          "SELECT dept FROM budget_2024_actuals ORDER BY amount DESC",
        ),
        [["Ops"], ["IT"]],
        "xlsx",
      );
    },
  },
  {
    name: "caps stored rows, previews 20 rows, and flags truncation",
    async run(sb) {
      const all = success(
        await sb.sql("SELECT i FROM range(25) t(i)"),
        "range 25",
      );
      eq(
        [all.row_count, all.preview.length, all.truncated],
        [25, 20, false],
        "uncapped",
      );
      const capped = success(
        await sb.sql("SELECT i FROM range(25) t(i)", { maxRows: 10 }),
        "capped",
      );
      eq(
        [capped.row_count, capped.preview.length, capped.truncated],
        [10, 10, true],
        "capped",
      );
      const stored = sb.getResult(capped.result_id);
      eq(stored?.rows.length, 10, "stored rows");
      eq(stored?.rows[9], [9], "last stored row");
      eq(stored?.truncated, true, "stored truncated flag");
      const exact = success(
        await sb.sql("SELECT i FROM range(10) t(i)", { maxRows: 10 }),
        "exact",
      );
      eq(exact.truncated, false, "exactly maxRows is not truncated");
    },
  },
  {
    name: "cuts long preview text but stores the full value",
    async run(sb) {
      const r = success(
        await sb.sql("SELECT repeat('x', 300) AS s"),
        "long text",
      );
      eq(String(r.preview[0]?.[0]).length, 200, "preview cell");
      eq(
        String(sb.getResult(r.result_id)?.rows[0]?.[0]).length,
        300,
        "stored cell",
      );
      eq(sb.getResult("r999999"), undefined, "unknown result id");
    },
  },
  {
    name: "runs DESCRIBE, SUMMARIZE, PIVOT, and queries with trailing comments",
    async run(sb) {
      const d = success(await sb.sql("DESCRIBE people"), "describe");
      eq([d.columns[0]?.name, d.row_count], ["column_name", 6], "describe");
      eq(
        success(await sb.sql("SUMMARIZE orders"), "summarize").row_count,
        5,
        "summarize",
      );
      const p = success(
        await sb.sql(
          "PIVOT (SELECT product, qty FROM orders) ON product USING sum(qty)",
        ),
        "pivot",
      );
      eq(
        p.columns.map((c) => c.name),
        ["doohickey", "gadget", "widget"],
        "pivot columns",
      );
      eq(p.preview, [[5, 1, 5]], "pivot values");
      eq(
        await rows(sb, "SELECT 42 AS answer -- the answer"),
        [[42]],
        "trailing comment",
      );
    },
  },
  {
    name: "returns SQL errors and guard rejections as short messages",
    async run(sb) {
      failure(
        await sb.sql("SELECT nope FROM people"),
        /nope/,
        "unknown column",
      );
      failure(await sb.sql("DROP TABLE people"), /SQL guard/, "drop");
      failure(
        await sb.sql("SELECT 1; DROP TABLE people"),
        /SQL guard/,
        "stacked",
      );
      failure(
        await sb.sql("SELECT * FROM read_csv('people.csv')"),
        /SQL guard/,
        "read_csv",
      );
      failure(
        await sb.sql("SELECT * FROM 'https://evil.example/x.csv'"),
        /SQL guard/,
        "url",
      );
      eq(
        await rows(sb, "SELECT count(*) FROM people"),
        [[6]],
        "people survives",
      );
    },
  },
  {
    name: "is locked down: no extension autoload, no file access, no config changes",
    async run(sb) {
      eq(
        await rows(
          sb,
          "SELECT current_setting('enable_external_access'), current_setting('autoload_known_extensions'), current_setting('autoinstall_known_extensions'), current_setting('lock_configuration')",
        ),
        [[false, false, false, true]],
        "settings",
      );
      // Replacement scans through quoted identifiers pass the guard; the engine blocks them.
      failure(
        await sb.sql('SELECT * FROM "secret.csv"'),
        /.+/,
        "replacement scan",
      );
      failure(
        await sb.sql('SELECT * FROM "uploads/f1.csv"'),
        /.+/,
        "uploaded file was dropped",
      );
    },
  },
  {
    name: "cancels a query at the timeout and keeps working",
    async run(sb) {
      const start = Date.now();
      failure(
        await sb.sql(
          "SELECT count(*) FROM range(10000000000) t(i) WHERE i % 7 = 3",
          { timeoutMs: 300 },
        ),
        /timed out after 0.3 s/,
        "timeout",
      );
      check(Date.now() - start < 5000, `cancel took ${Date.now() - start} ms`);
      eq(await rows(sb, "SELECT 1 + 1"), [[2]], "works after a timeout");
    },
  },
];
