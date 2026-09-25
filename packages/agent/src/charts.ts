// make_chart: the model sends a small Vega-Lite subset (mark + encoding) that
// names columns of a stored result. The app checks it here and injects the
// rows client-side, so chart data never goes to the model. A fixed vocabulary
// (no data, transforms, or URLs) also keeps the spec from fetching anything.
// It stays small because its schema is sent with every step: aggregation,
// binning, and date bucketing happen in SQL before the chart.

import type { Cell, Column } from "./sandbox.ts";

export const MARKS = [
  "bar",
  "line",
  "area",
  "point",
  "tick",
  "rect",
  "arc",
  "boxplot",
] as const;
export const CHANNELS = ["x", "y", "color", "theta"] as const;
export const ENCODING_TYPES = [
  "quantitative",
  "nominal",
  "ordinal",
  "temporal",
] as const;
export const SORTS = ["ascending", "descending", "x", "-x", "y", "-y"] as const;

export const MAX_CHART_ROWS = 5000;

export type Mark = (typeof MARKS)[number];
export type Channel = (typeof CHANNELS)[number];

export interface ChartChannel {
  field: string;
  type: (typeof ENCODING_TYPES)[number];
  sort?: (typeof SORTS)[number];
  title?: string;
}

export interface ChartSpec {
  mark: Mark;
  title?: string;
  encoding: Partial<Record<Channel, ChartChannel>>;
}

/** A chart as the trace and the UI keep it (the model only sees chart_id). */
export interface ChartRecord {
  chart_id: string;
  result_id: string;
  spec: ChartSpec;
  rows: number;
}

/**
 * Checks a make_chart spec against the result it plots and fixes the case of
 * field names. Returns the spec to store or a problem the model can fix.
 */
export function checkChart(
  spec: ChartSpec,
  resultId: string,
  columns: readonly Column[],
  rowCount: number,
): { spec: ChartSpec } | { error: string } {
  if (rowCount === 0)
    return { error: `${resultId} has no rows, so there is nothing to plot.` };
  if (rowCount > MAX_CHART_ROWS)
    return {
      error: `${resultId} has ${rowCount} rows; a chart takes at most ${MAX_CHART_ROWS}. Aggregate or sample in SQL first, then chart that result.`,
    };
  const entries = Object.entries(spec.encoding) as [Channel, ChartChannel][];
  const has = (c: Channel) => spec.encoding[c] !== undefined;
  if (spec.mark === "arc" ? !has("theta") : !has("x") && !has("y"))
    return {
      error:
        spec.mark === "arc"
          ? "An arc (pie) chart needs a theta channel for the values, and usually color for the categories."
          : "The encoding needs an x or a y channel.",
    };
  const names = columns.map((c) => c.name);
  const encoding: ChartSpec["encoding"] = {};
  for (const [channel, enc] of entries) {
    const field =
      names.find((n) => n === enc.field) ??
      names.find((n) => n.toLowerCase() === enc.field.toLowerCase());
    if (field === undefined)
      return {
        error: `encoding.${channel}.field "${enc.field}" is not a column of ${resultId}, which has ${names.map((n) => `"${n}"`).join(", ")}.`,
      };
    encoding[channel] = { ...enc, field };
  }
  return { spec: { ...spec, encoding } };
}

/** Vega-Lite reads dots and brackets in field names as nested access. */
const escapeField = (f: string) => f.replace(/[.[\]\\]/g, (m) => `\\${m}`);

/** The full Vega-Lite spec the app renders: the model's spec plus the rows. */
export function vegaLiteSpec(
  spec: ChartSpec,
  result: { columns: readonly Column[]; rows: readonly Cell[][] },
): Record<string, unknown> {
  const names = result.columns.map((c) => c.name);
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    ...(spec.title ? { title: spec.title } : {}),
    data: {
      values: result.rows.map((r) =>
        Object.fromEntries(names.map((n, i) => [n, r[i] ?? null])),
      ),
    },
    mark: { type: spec.mark, tooltip: true },
    encoding: Object.fromEntries(
      Object.entries(spec.encoding).map(([channel, enc]) => [
        channel,
        { ...enc, field: escapeField(enc.field) },
      ]),
    ),
    width: "container",
    height: 260,
  };
}
