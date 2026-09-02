/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { pendingClaimMatchesDraft, shouldDeferAutoSave, type ClaimResolution } from "./pending-claim";

const shared = { destination: "Lisbon", startDate: "2026-10-01", endDate: "2026-10-03" };

describe("pendingClaimMatchesDraft", () => {
  it("matches the same destination and dates, ignoring case and whitespace", () => {
    expect(pendingClaimMatchesDraft(shared, { ...shared, destination: "  lisbon " })).toBe(true);
  });

  it("does not match a different destination or different dates", () => {
    expect(pendingClaimMatchesDraft(shared, { ...shared, destination: "Porto" })).toBe(false);
    expect(pendingClaimMatchesDraft(shared, { ...shared, endDate: "2026-10-04" })).toBe(false);
    expect(pendingClaimMatchesDraft(shared, { ...shared, startDate: "2026-09-30" })).toBe(false);
  });

  it("never matches an empty draft, so a fresh wizard is not mistaken for the shared trip", () => {
    expect(pendingClaimMatchesDraft(shared, { destination: "", startDate: "", endDate: "" })).toBe(false);
    expect(pendingClaimMatchesDraft(shared, { destination: "Lisbon", startDate: "", endDate: "2026-10-03" })).toBe(false);
    expect(pendingClaimMatchesDraft(shared, null)).toBe(false);
    expect(pendingClaimMatchesDraft(null, shared)).toBe(false);
  });
});

describe("shouldDeferAutoSave", () => {
  const all: ClaimResolution[] = ["none", "unresolved", "adopted", "released"];

  it("defers only while the matching claim is unresolved", () => {
    for (const resolution of all) {
      expect(shouldDeferAutoSave({ matches: true, resolution })).toBe(resolution === "unresolved");
    }
  });

  it("never defers a draft that is a different trip", () => {
    for (const resolution of all) {
      expect(shouldDeferAutoSave({ matches: false, resolution })).toBe(false);
    }
  });
});
