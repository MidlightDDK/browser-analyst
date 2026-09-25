// Column profiles for describe_table, built from DuckDB SUMMARIZE plus
// approx_top_k. Shared by every adapter so profiles match exactly.

import { quoteIdent, truncateCell } from "./cells.ts";
import type { Cell, Column, ColumnProfile, TableProfile } from "./sandbox.ts";

/** Runs trusted, app-written SQL (no guard) and returns canonical rows. */
export type Exec = (
  sql: string,
) => Promise<{ columns: Column[]; rows: Cell[][] }>;

export const PROFILE_CELL_CHARS = 60;
const SAMPLE_ROWS = 3;
const TOP_VALUES = 5;
const TOP_VALUES_MAX_COLUMNS = 50;
const LOW_CARDINALITY = 20;

const NUMERIC = new Set([
  "TINYINT",
  "SMALLINT",
  "INTEGER",
  "BIGINT",
  "HUGEINT",
  "UTINYINT",
  "USMALLINT",
  "UINTEGER",
  "UBIGINT",
  "UHUGEINT",
  "FLOAT",
  "DOUBLE",
  "DECIMAL",
]);
const isNumeric = (duckdbType: string) =>
  NUMERIC.has(duckdbType.replace(/\(.*$/, "").toUpperCase());
const isText = (duckdbType: string) =>
  /^(VARCHAR|BOOLEAN|ENUM)/i.test(duckdbType);

function field(columns: Column[], row: Cell[], name: string): Cell {
  const i = columns.findIndex((c) => c.name === name);
  return i === -1 ? null : (row[i] ?? null);
}

function bound(value: Cell, duckdbType: string): Cell {
  if (value === null) return null;
  if (isNumeric(duckdbType) && Number.isFinite(Number(value)))
    return Number(value);
  return truncateCell(String(value), PROFILE_CELL_CHARS);
}

export async function profileTable(
  exec: Exec,
  table: string,
): Promise<TableProfile> {
  const t = quoteIdent(table);
  const summary = await exec(`SUMMARIZE ${t}`);
  const stats = summary.rows.map((row) => {
    const get = (name: string) => field(summary.columns, row, name);
    const type = String(get("column_type"));
    return {
      name: String(get("column_name")),
      type,
      null_pct: Math.round(Number(get("null_percentage") ?? 0) * 100) / 100,
      approx_distinct: Number(get("approx_unique") ?? 0),
      min: bound(get("min"), type),
      max: bound(get("max"), type),
      count: Number(get("count") ?? 0),
    };
  });

  const topCols = stats
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s }) =>
        isText(s.type) ||
        (s.approx_distinct <= LOW_CARDINALITY && s.approx_distinct < s.count),
    )
    .slice(0, TOP_VALUES_MAX_COLUMNS);
  const top = new Map<number, Cell[]>();
  if (topCols.length > 0) {
    const select = topCols
      .map(
        ({ s, i }) =>
          `to_json(approx_top_k(${quoteIdent(s.name)}, ${TOP_VALUES}))::VARCHAR AS c${i}`,
      )
      .join(", ");
    const res = await exec(`SELECT ${select} FROM ${t}`);
    topCols.forEach(({ i }, k) => {
      const json = res.rows[0]?.[k];
      const values =
        typeof json === "string" ? (JSON.parse(json) as unknown[]) : [];
      top.set(
        i,
        values.map((v) =>
          truncateCell(
            v === null || typeof v === "number" || typeof v === "boolean"
              ? v
              : String(v),
            PROFILE_CELL_CHARS,
          ),
        ),
      );
    });
  }

  const sample = await exec(`SELECT * FROM ${t} LIMIT ${SAMPLE_ROWS}`);
  const columns: ColumnProfile[] = stats.map((s, i) => ({
    name: s.name,
    type: s.type,
    null_pct: s.null_pct,
    approx_distinct: s.approx_distinct,
    min: s.min,
    max: s.max,
    top_values: top.get(i) ?? [],
  }));
  return {
    table,
    rows: stats[0]?.count ?? 0,
    columns,
    sample_rows: sample.rows.map((r) =>
      r.map((c) => truncateCell(c, PROFILE_CELL_CHARS)),
    ),
  };
}
