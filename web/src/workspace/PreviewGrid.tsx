// Virtualized table preview: renders only the rows in view and fetches them
// from DuckDB in pages, so a 500k-row table scrolls like a 50-row one. Rows
// are absolutely positioned divs with ARIA table roles, which native table
// elements do not allow; biome.json turns off the rules that want them.

import type { Cell, Column } from "@browser-analyst/agent";
import { useEffect, useReducer, useRef, useState } from "react";
import { formatCell, formatCount } from "../format";

export const ROW_HEIGHT = 28;
const PAGE_ROWS = 200;
const OVERSCAN = 10;
const VIEWPORT = 420;
const COL_WIDTH = 176;
const INDEX_WIDTH = 72;

/** The row range to render for a scroll position. */
export function visibleRange(
  scrollTop: number,
  viewport: number,
  rowCount: number,
) {
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN,
  );
  return { first, last };
}

const NUMERIC = /INT|DOUBLE|FLOAT|DECIMAL/;

export function PreviewGrid({
  table,
  columns,
  rowCount,
  fetchRows,
}: {
  table: string;
  columns: Column[];
  rowCount: number;
  fetchRows: (offset: number, limit: number) => Promise<Cell[][]>;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const pages = useRef(new Map<number, Cell[][] | "loading">());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const { first, last } = visibleRange(scrollTop, VIEWPORT, rowCount);

  useEffect(() => {
    if (last <= first) return;
    for (
      let p = Math.floor(first / PAGE_ROWS);
      p <= Math.floor((last - 1) / PAGE_ROWS);
      p++
    ) {
      if (pages.current.has(p)) continue;
      pages.current.set(p, "loading");
      fetchRows(p * PAGE_ROWS, PAGE_ROWS).then(
        (rows) => {
          pages.current.set(p, rows);
          rerender();
        },
        () => pages.current.delete(p),
      );
    }
  }, [first, last, fetchRows]);

  const width = INDEX_WIDTH + columns.length * COL_WIDTH;
  const rows = [];
  for (let i = first; i < last; i++) {
    const page = pages.current.get(Math.floor(i / PAGE_ROWS));
    const row = Array.isArray(page) ? page[i % PAGE_ROWS] : undefined;
    rows.push(
      <div
        key={i}
        role="row"
        aria-rowindex={i + 2}
        className="absolute left-0 flex border-b border-slate-100 text-sm dark:border-slate-800/70"
        style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, width }}
      >
        <div
          role="rowheader"
          className="shrink-0 px-2 py-1 text-right font-mono text-xs leading-5 text-slate-500"
          style={{ width: INDEX_WIDTH }}
        >
          {formatCount(i + 1)}
        </div>
        {columns.map((col, c) => {
          const cell = row?.[c];
          const text = row ? formatCell(cell ?? null) : "";
          return (
            <div
              key={col.name}
              role="cell"
              title={text}
              className={`shrink-0 truncate px-2 py-1 leading-5 ${
                NUMERIC.test(col.type) ? "text-right tabular-nums" : ""
              } ${cell === null ? "italic text-slate-400" : ""}`}
              style={{ width: COL_WIDTH }}
            >
              {text}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div
      role="table"
      aria-label={`Rows of ${table}`}
      aria-rowcount={rowCount + 1}
      aria-colcount={columns.length + 1}
      tabIndex={0}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="relative overflow-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-slate-800"
      style={{ height: Math.min(VIEWPORT, (rowCount + 1) * ROW_HEIGHT + 2) }}
    >
      <div
        role="row"
        aria-rowindex={1}
        className="sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-sm font-medium dark:border-slate-800 dark:bg-slate-900"
        style={{ width, height: ROW_HEIGHT }}
      >
        <div
          role="columnheader"
          className="shrink-0 px-2 py-1 text-right text-xs leading-5 text-slate-500"
          style={{ width: INDEX_WIDTH }}
        >
          #
        </div>
        {columns.map((col) => (
          <div
            key={col.name}
            role="columnheader"
            title={`${col.name} (${col.type})`}
            className={`shrink-0 truncate px-2 py-1 leading-5 ${NUMERIC.test(col.type) ? "text-right" : ""}`}
            style={{ width: COL_WIDTH }}
          >
            {col.name}
          </div>
        ))}
      </div>
      <div
        className="relative"
        style={{ height: rowCount * ROW_HEIGHT, width }}
      >
        {rows}
      </div>
    </div>
  );
}
