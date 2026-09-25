import {
  type ChartRecord,
  type StoredResult,
  vegaLiteSpec,
} from "@browser-analyst/agent";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ResultTable } from "./ResultTable";

// Categorical slots and chrome from the dataviz reference palette, checked
// with its validator against white and slate-950. Three light-mode hues sit
// under 3:1 contrast, so every chart has tooltips and a "Show data" table.
const THEMES = {
  light: {
    series: [
      "#2a78d6",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
      "#4a3aa7",
      "#e34948",
    ],
    text: "#52514e",
    muted: "#6b6a65",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
  },
  dark: {
    series: [
      "#3987e5",
      "#d95926",
      "#199e70",
      "#c98500",
      "#d55181",
      "#008300",
      "#9085e9",
      "#e66767",
    ],
    text: "#c3c2b7",
    muted: "#a3a29b",
    grid: "#1e293b",
    axis: "#383835",
  },
};

function config(dark: boolean) {
  const t = dark ? THEMES.dark : THEMES.light;
  return {
    background: "transparent",
    font: "ui-sans-serif, system-ui, sans-serif",
    range: { category: t.series },
    mark: { color: t.series[0] },
    bar: { cornerRadiusEnd: 4 },
    line: { strokeWidth: 2 },
    point: { size: 64, filled: true },
    arc: { stroke: dark ? "#020617" : "#ffffff", strokeWidth: 2 },
    view: { stroke: null },
    axis: {
      labelColor: t.muted,
      titleColor: t.text,
      domainColor: t.axis,
      tickColor: t.axis,
      gridColor: t.grid,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 500,
    },
    legend: { labelColor: t.text, titleColor: t.text },
    title: { color: t.text, fontSize: 13, fontWeight: 600, anchor: "start" },
  };
}

const TABLE_ROWS = 200;

const darkQuery = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const q = darkQuery();
      q?.addEventListener("change", onChange);
      return () => q?.removeEventListener("change", onChange);
    },
    () => darkQuery()?.matches ?? false,
  );
}

/**
 * A make_chart chart: the model's spec plus the stored rows, drawn by
 * vega-embed (lazy-loaded). `ast` makes Vega interpret expressions instead of
 * compiling them with Function(), which the CSP forbids.
 */
export function ChartView({
  chart,
  getResult,
}: {
  chart: ChartRecord;
  getResult: (id: string) => StoredResult | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lookup = useRef(getResult);
  lookup.current = getResult;
  const [result, setResult] = useState<StoredResult | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const dark = usePrefersDark();

  useEffect(() => {
    const el = ref.current;
    const stored = lookup.current(chart.result_id);
    setResult(stored);
    if (!el || !stored) return;
    let cancelled = false;
    let finalize: (() => void) | undefined;
    import("vega-embed")
      .then(async ({ default: embed }) => {
        if (cancelled) return;
        const spec = {
          ...vegaLiteSpec(chart.spec, stored),
          config: config(dark),
        };
        const view = await embed(el, spec as never, {
          actions: false,
          renderer: "svg",
          ast: true,
        });
        if (cancelled) view.finalize();
        else finalize = () => view.finalize();
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [chart, dark]);

  const label = chart.spec.title || `${chart.spec.mark} chart`;
  return (
    <figure
      aria-label={`Chart ${chart.chart_id}: ${label}`}
      className="space-y-1"
    >
      <div ref={ref} className="w-full" />
      {error && (
        <p role="alert" className="text-xs text-red-800 dark:text-red-300">
          <span aria-hidden="true">✕ </span>The chart couldn’t be drawn: {error}
        </p>
      )}
      {!result && (
        <p className="text-sm">Result {chart.result_id} isn’t available.</p>
      )}
      <figcaption className="text-xs text-slate-600 dark:text-slate-400">
        {chart.chart_id} · drawn here from all {chart.rows} row
        {chart.rows === 1 ? "" : "s"} of {chart.result_id} (the model never saw
        them){" "}
        {result && (
          <button
            type="button"
            aria-expanded={showData}
            onClick={() => setShowData(!showData)}
            className="font-medium underline underline-offset-2"
          >
            {showData ? "Hide data" : "Show data"}
          </button>
        )}
      </figcaption>
      {showData && result && (
        <ResultTable
          columns={result.columns}
          rows={result.rows.slice(0, TABLE_ROWS)}
          caption={`Data behind chart ${chart.chart_id} (${chart.result_id}${result.rows.length > TABLE_ROWS ? `, first ${TABLE_ROWS} rows` : ""})`}
        />
      )}
    </figure>
  );
}
