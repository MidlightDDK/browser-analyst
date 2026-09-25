// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PreviewGrid, ROW_HEIGHT, visibleRange } from "./PreviewGrid";

it("computes the rendered range with overscan and clamps to the table", () => {
  expect(visibleRange(0, 420, 500_000)).toEqual({ first: 0, last: 25 });
  expect(visibleRange(1000 * ROW_HEIGHT, 420, 500_000)).toEqual({
    first: 990,
    last: 1025,
  });
  expect(visibleRange(0, 420, 3)).toEqual({ first: 0, last: 3 });
});

it("renders only the visible rows of a large table and fetches one page", async () => {
  const fetchRows = vi.fn(async (offset: number, limit: number) =>
    Array.from({ length: limit }, (_, i) => [offset + i, `name ${offset + i}`]),
  );
  render(
    <PreviewGrid
      table="big"
      columns={[
        { name: "id", type: "BIGINT" },
        { name: "name", type: "VARCHAR" },
      ]}
      rowCount={500_000}
      fetchRows={fetchRows}
    />,
  );
  expect(screen.getByRole("table").getAttribute("aria-rowcount")).toBe(
    "500001",
  );
  await waitFor(() => expect(screen.getByText("name 24")).toBeTruthy());
  // Header row plus rows 0..24.
  expect(screen.getAllByRole("row")).toHaveLength(26);
  expect(fetchRows).toHaveBeenCalledTimes(1);
  expect(fetchRows).toHaveBeenCalledWith(0, 200);
});
