import { describe, it, expect } from "vitest";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";
import { DEFAULT_STATE } from "@/types/agent-state";

describe("Week 1 smoke tests", () => {
  it("DEFAULT_STATE has expected shape", () => {
    expect(DEFAULT_STATE.mode).toBe("voter");
    expect(DEFAULT_STATE.stage).toBe("idle");
    expect(DEFAULT_STATE.candidates).toEqual([]);
    expect(DEFAULT_STATE.briefReady).toBe(false);
  });

  it("bioguidePhotoUrl builds correct URL for Gwen Moore", () => {
    expect(bioguidePhotoUrl("M000160")).toBe(
      "https://bioguide.congress.gov/bioguide/photo/M/M000160.jpg"
    );
  });

  it("placeholderAvatarUrl returns a data URI", () => {
    const url = placeholderAvatarUrl("Gwen Moore", "DEM");
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("bioguidePhotoUrl returns null for empty string", () => {
    expect(bioguidePhotoUrl("")).toBeNull();
  });
});
