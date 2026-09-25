// Shared ingestion rules: file format detection, safe table names, the DuckDB
// load statement, and spreadsheet → CSV conversion (SheetJS CE).

import { quoteIdent, quoteString } from "./cells.ts";

export type FileFormat = "csv" | "tsv" | "parquet" | "json" | "xlsx";
/** Formats DuckDB reads natively; spreadsheets become CSV first. */
export type LoadFormat = Exclude<FileFormat, "xlsx">;

const EXTENSIONS: Record<string, FileFormat> = {
  csv: "csv",
  tsv: "tsv",
  tab: "tsv",
  parquet: "parquet",
  pq: "parquet",
  json: "json",
  jsonl: "json",
  ndjson: "json",
  xlsx: "xlsx",
  xlsm: "xlsx",
  xls: "xlsx",
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS).map((e) => `.${e}`);

export function detectFormat(fileName: string): FileFormat | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return (ext && EXTENSIONS[ext]) || null;
}

// Words that make a bare table name awkward in SQL.
const RESERVED = new Set([
  "all",
  "and",
  "as",
  "by",
  "case",
  "from",
  "group",
  "join",
  "limit",
  "on",
  "or",
  "order",
  "select",
  "table",
  "to",
  "union",
  "where",
  "with",
]);

const MAX_TABLE_NAME = 48;

/** A lowercase snake_case table name that is unique among `taken`. */
export function tableNameFor(raw: string, taken: ReadonlySet<string>): string {
  let base = (detectFormat(raw) ? raw.replace(/\.[A-Za-z0-9]+$/, "") : raw)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_TABLE_NAME)
    .replace(/_+$/, "");
  if (!base) base = "data";
  if (/^[0-9]/.test(base) || RESERVED.has(base)) base = `t_${base}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  return name;
}

export function loadSql(
  table: string,
  path: string,
  format: LoadFormat,
): string {
  const src = quoteString(path);
  const read = {
    csv: `read_csv(${src})`,
    tsv: `read_csv(${src}, delim = '\t')`,
    parquet: `read_parquet(${src})`,
    json: `read_json(${src})`,
  }[format];
  return `CREATE TABLE ${quoteIdent(table)} AS SELECT * FROM ${read}`;
}

export interface SheetCsv {
  sheet: string;
  csv: Uint8Array;
}

/**
 * Converts each non-empty sheet to CSV. Numbers keep full precision and dates
 * become ISO text so DuckDB's sniffer types them.
 */
export async function xlsxToCsv(bytes: Uint8Array): Promise<SheetCsv[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", dense: true, cellNF: true });
  const out: SheetCsv[] = [];
  const encoder = new TextEncoder();
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    for (const row of ws["!data"] ?? []) {
      for (const cell of row ?? []) {
        if (cell?.t !== "n" || !cell.z || !XLSX.SSF.is_date(cell.z)) continue;
        const d = XLSX.SSF.parse_date_code(cell.v as number);
        if (!d) continue;
        const pad = (n: number) => String(n).padStart(2, "0");
        const date = `${d.y}-${pad(d.m)}-${pad(d.d)}`;
        const iso =
          d.H || d.M || d.S
            ? `${date} ${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}`
            : date;
        Object.assign(cell, { t: "s", v: iso, w: iso });
      }
    }
    const csv = XLSX.utils.sheet_to_csv(ws, {
      rawNumbers: true,
      blankrows: false,
    });
    if (csv.trim()) out.push({ sheet, csv: encoder.encode(csv) });
  }
  return out;
}

export interface IngestPart {
  table: string;
  source: string;
  format: LoadFormat;
  bytes: Uint8Array;
}

/**
 * Splits an upload into DuckDB-loadable parts: one per file, or one per sheet
 * for spreadsheets (`toCsv` lets the browser run SheetJS in a worker).
 */
export async function planIngest(
  fileName: string,
  bytes: Uint8Array,
  taken: ReadonlySet<string>,
  toCsv: (bytes: Uint8Array) => Promise<SheetCsv[]> = xlsxToCsv,
): Promise<IngestPart[]> {
  const format = detectFormat(fileName);
  if (!format)
    throw new Error(
      `Unsupported file type: ${fileName}. Use ${ACCEPTED_EXTENSIONS.join(", ")}.`,
    );
  if (format !== "xlsx")
    return [
      { table: tableNameFor(fileName, taken), source: fileName, format, bytes },
    ];

  const sheets = await toCsv(bytes);
  if (sheets.length === 0)
    throw new Error(`${fileName} has no non-empty sheets.`);
  const names = new Set(taken);
  return sheets.map(({ sheet, csv }) => {
    const base =
      sheets.length === 1
        ? fileName
        : `${fileName.replace(/\.[^.]+$/, "")}_${sheet}`;
    const table = tableNameFor(base, names);
    names.add(table);
    return {
      table,
      source: `${fileName} › ${sheet}`,
      format: "csv",
      bytes: csv,
    };
  });
}
