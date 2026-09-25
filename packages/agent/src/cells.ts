// Canonical cell values and type labels, so the browser (Arrow) and Node
// (@duckdb/node-api) adapters return identical results for the same query.

import type { Cell } from "./sandbox.ts";

/**
 * Maps a DuckDB type name to the label the browser adapter reports. DuckDB-WASM
 * runs with castDecimalToDouble, which also turns HUGEINT into DOUBLE.
 */
export function canonicalType(duckdbType: string): string {
  const t = duckdbType.toUpperCase();
  if (t.endsWith("[]") || /^[A-Z]+\[\d+\]$/.test(t)) return "LIST";
  const base = t.replace(/\(.*$/s, "").trim();
  if (base === "DECIMAL" || base === "HUGEINT" || base === "UHUGEINT")
    return "DOUBLE";
  if (base.startsWith("TIMESTAMP")) return "TIMESTAMP";
  if (base === "TIME WITH TIME ZONE" || base === "TIMETZ") return "TIME";
  if (base === "ENUM" || base === "UUID" || base === "JSON") return "VARCHAR";
  if (base === "REAL" || base === "FLOAT4") return "FLOAT";
  if (base === "ARRAY") return "LIST";
  return base;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function formatDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const millis = d.getUTCMilliseconds();
  return `${formatDate(ms)} ${time}${millis ? `.${pad(millis, 3)}` : ""}`;
}

function formatTimeMicros(micros: bigint | number): string {
  const total = Math.floor(Number(micros) / 1e6);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

const jsonReplacer = (_key: string, v: unknown) =>
  typeof v === "bigint" ? bigintToCell(v) : v;

function bigintToCell(v: bigint): number | string {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) &&
    v >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(v)
    : v.toString();
}

/** Converts an adapter's raw value to a canonical cell, given its type label. */
export function toCell(value: unknown, type: string): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return toCell(value.getTime(), type);
  if (
    type === "TIME" &&
    (typeof value === "bigint" || typeof value === "number")
  )
    return formatTimeMicros(value);
  if (typeof value === "bigint") return bigintToCell(value);
  if (typeof value === "number") {
    if (type === "DATE") return formatDate(value);
    if (type === "TIMESTAMP") return formatTimestamp(value);
    return Number.isFinite(value) ? value : String(value);
  }
  if (value instanceof Uint8Array) return `<blob ${value.length} bytes>`;
  if (typeof value === "object") {
    const plain =
      "toJSON" in value && typeof value.toJSON === "function"
        ? value.toJSON()
        : value;
    return JSON.stringify(plain, jsonReplacer) ?? null;
  }
  return String(value);
}

/** Cuts long text cells for previews shown to the model. */
export function truncateCell(cell: Cell, max: number): Cell {
  return typeof cell === "string" && cell.length > max
    ? `${cell.slice(0, max - 1)}…`
    : cell;
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
