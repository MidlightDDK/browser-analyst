// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the placeholder headline and status", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
    "Your data never leaves your browser.",
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Under construction",
  );
});
