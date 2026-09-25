import type { TableProfile } from "@browser-analyst/agent";
import { formatCell, formatCount } from "../format";

export function ProfileTable({ profile }: { profile: TableProfile }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Column profile of {profile.table}</caption>
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Column
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Type
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Nulls
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Distinct ≈
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Min
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Max
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Frequent values
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {profile.columns.map((c) => (
            <tr key={c.name}>
              <th
                scope="row"
                className="max-w-48 truncate px-3 py-2 font-medium"
                title={c.name}
              >
                {c.name}
              </th>
              <td className="px-3 py-2 font-mono text-xs">{c.type}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {c.null_pct}%
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCount(c.approx_distinct)}
              </td>
              <td
                className="max-w-40 truncate px-3 py-2"
                title={formatCell(c.min)}
              >
                {formatCell(c.min)}
              </td>
              <td
                className="max-w-40 truncate px-3 py-2"
                title={formatCell(c.max)}
              >
                {formatCell(c.max)}
              </td>
              <td
                className="max-w-72 truncate px-3 py-2 text-slate-700 dark:text-slate-300"
                title={c.top_values.map(formatCell).join(", ")}
              >
                {c.top_values.length
                  ? c.top_values.map(formatCell).join(", ")
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
