import type { Cell } from "@browser-analyst/agent";

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCell(cell: Cell): string {
  if (cell === null) return "NULL";
  if (typeof cell === "number")
    return Number.isInteger(cell)
      ? String(cell)
      : String(Number(cell.toPrecision(12)));
  return String(cell);
}
