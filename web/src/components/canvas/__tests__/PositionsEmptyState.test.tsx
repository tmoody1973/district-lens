import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PositionsEmptyState } from "../PositionsEmptyState";

const candidate = (candidateId: string, name: string) => ({ candidateId, name });

test("renders one crisp line per no-footprint candidate", () => {
  render(
    <PositionsEmptyState
      candidates={[candidate("H1", "Jane Doe"), candidate("H2", "John Smith")]}
      hasOthers={false}
    />,
  );
  expect(screen.getByText("Jane Doe")).toBeDefined();
  expect(screen.getByText("John Smith")).toBeDefined();
  expect(
    screen.getAllByText(/No public positions found in indexed sources yet/i),
  ).toHaveLength(2);
});

test("renders nothing when no candidates are passed", () => {
  const { container } = render(
    <PositionsEmptyState candidates={[]} hasOthers={true} />,
  );
  expect(container.firstChild).toBeNull();
});
