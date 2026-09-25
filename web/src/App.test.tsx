// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the headline, three samples, and a file chooser", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
    "Your data never leaves your browser.",
  );
  expect(
    screen.getAllByRole("button", { name: /^Open the .* sample$/ }),
  ).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Choose files" })).toBeTruthy();
});
