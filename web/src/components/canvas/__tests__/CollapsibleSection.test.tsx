import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CollapsibleSection } from "../CollapsibleSection";

test("renders the title and children", () => {
  render(<CollapsibleSection title="Money detail" defaultOpen><p>inner content</p></CollapsibleSection>);
  expect(screen.getByText("Money detail")).toBeInTheDocument();
  expect(screen.getByText("inner content")).toBeInTheDocument();
});

test("collapsed by default when defaultOpen is false", () => {
  render(<CollapsibleSection title="Recent news" defaultOpen={false}><p>hidden</p></CollapsibleSection>);
  const details = screen.getByText("Recent news").closest("details");
  expect(details).not.toHaveAttribute("open");
});
