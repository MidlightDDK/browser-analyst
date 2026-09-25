import { describe, expect, it } from "vitest";
import { type ChartSpec, checkChart, vegaLiteSpec } from "./charts.ts";

const columns = [
  { name: "species", type: "VARCHAR" },
  { name: "mass.g", type: "DOUBLE" },
];

describe("charts", () => {
  it("builds the Vega-Lite spec from the stored rows, escaping dotted names", () => {
    const spec: ChartSpec = {
      mark: "bar",
      encoding: {
        x: { field: "species", type: "nominal" },
        y: { field: "mass.g", type: "quantitative" },
      },
    };
    const vl = vegaLiteSpec(spec, {
      columns,
      rows: [
        ["Gentoo", 5076],
        ["Adelie", 3701],
      ],
    });
    expect(vl.data).toEqual({
      values: [
        { species: "Gentoo", "mass.g": 5076 },
        { species: "Adelie", "mass.g": 3701 },
      ],
    });
    expect(vl.encoding).toMatchObject({ y: { field: "mass\\.g" } });
    expect(vl.mark).toEqual({ type: "bar", tooltip: true });
  });

  it("needs theta for pies and caps the rows a chart takes", () => {
    const pie: ChartSpec = {
      mark: "arc",
      encoding: { color: { field: "species", type: "nominal" } },
    };
    expect(checkChart(pie, "r1", columns, 3)).toEqual({
      error: expect.stringContaining("theta"),
    });
    const bar: ChartSpec = {
      mark: "bar",
      encoding: { x: { field: "SPECIES", type: "nominal" } },
    };
    expect(checkChart(bar, "r1", columns, 5001)).toEqual({
      error: expect.stringContaining("at most 5000"),
    });
    expect(checkChart(bar, "r1", columns, 0)).toEqual({
      error: expect.stringContaining("no rows"),
    });
    expect(checkChart(bar, "r1", columns, 3)).toEqual({
      spec: { ...bar, encoding: { x: { field: "species", type: "nominal" } } },
    });
  });
});
