import { describe, it, expect } from "vitest";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";

describe("bioguidePhotoUrl", () => {
  it("builds the correct URL for a known bioguide ID", () => {
    expect(bioguidePhotoUrl("M000160")).toBe(
      "https://bioguide.congress.gov/bioguide/photo/M/M000160.jpg"
    );
  });

  it("handles lowercase bioguide ID", () => {
    expect(bioguidePhotoUrl("b000574")).toBe(
      "https://bioguide.congress.gov/bioguide/photo/B/B000574.jpg"
    );
  });

  it("returns null for empty string", () => {
    expect(bioguidePhotoUrl("")).toBeNull();
  });
});

describe("placeholderAvatarUrl", () => {
  it("returns a data URI for DEM party", () => {
    const url = placeholderAvatarUrl("Jane Doe", "DEM");
    expect(url).toContain("data:");
  });

  it("returns a data URI for REP party", () => {
    const url = placeholderAvatarUrl("John Smith", "REP");
    expect(url).toContain("data:");
  });
});
