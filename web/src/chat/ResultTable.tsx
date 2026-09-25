import type { Cell, Column } from "@browser-analyst/agent";
import { formatCell } from "../format";

/** A small result grid; `highlight` marks the cell a key number cites. */
export function ResultTable({
  columns,
  rows,
  caption,
  firstRow = 0,
  highlight,
}: {
  columns: Column[];
  rows: Cell[][];
  caption: string;
  /** Index of rows[0] in the full result, for row numbers. */
  firstRow?: number;
  highlight?: { row: number; column: string };
}) {
  return (
    <div className="relative overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th scope="col" className="px-2 py-1 text-right font-medium">
              #
            </th>
            {columns.map((c) => (
              <th
                key={c.name}
                scope="col"
                className="whitespace-nowrap px-2 py-1 font-medium"
              >
                {c.name}{" "}
                <span className="font-normal text-slate-500">{c.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-mono dark:divide-slate-800">
          {rows.map((row, i) => {
            const n = firstRow + i;
            return (
              <tr key={n}>
                <td className="px-2 py-1 text-right text-slate-500">{n}</td>
                {columns.map((c, j) => {
                  const cited =
                    highlight?.row === n && highlight.column === c.name;
                  const cell = row[j] ?? null;
                  return (
                    <td
                      key={c.name}
                      className={`max-w-64 truncate whitespace-nowrap px-2 py-1 ${
                        typeof cell === "number" ? "text-right" : ""
                      } ${cited ? "bg-amber-100 font-semibold outline-2 outline-amber-500 dark:bg-amber-900/40" : ""}`}
                      title={formatCell(cell)}
                      aria-label={
                        cited ? `cited: ${formatCell(cell)}` : undefined
                      }
                    >
                      {cited && <span aria-hidden="true">▶ </span>}
                      {formatCell(cell)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
