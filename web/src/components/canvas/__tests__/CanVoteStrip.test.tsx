import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CanVoteStrip } from "../CanVoteStrip";

test("names the state and exposes official logistics links that open safely", () => {
  render(<CanVoteStrip stateCode="WI" />);

  expect(screen.getByText(/Can you vote in Wisconsin\?/)).toBeInTheDocument();

  const registration = screen.getByRole("link", { name: /Check registration/ });
  expect(registration).toHaveAttribute("href", "https://vote.gov/");
  expect(registration).toHaveAttribute("target", "_blank");
  expect(registration).toHaveAttribute("rel", "noopener noreferrer");

  expect(screen.getByRole("link", { name: /full ballot/ })).toHaveAttribute(
    "href",
    "https://www.vote411.org/"
  );
});
