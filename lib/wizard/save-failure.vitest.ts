import { describe, expect, it } from "vitest";
import { saveErrorClass } from "./save-failure";

describe("saveErrorClass", () => {
  it.each([
    ["TypeError: Failed to fetch", "network"],
    ["connect ECONNRESET", "network"],
    ["request timeout", "network"],
    ["auto-save: no client session", "network"],
    ['new row violates row-level security policy for table "trips"', "rls"],
    ["permission denied for table trips", "rls"],
    ["insert_trip_dedup requires an authenticated caller", "rls"],
    ["Rate limit exceeded", "rate_limit"],
    ["HTTP 429", "rate_limit"],
    ["destination is required", "validation"],
    ["invalid input syntax for type date", "validation"],
    ["something else broke", "unknown"],
    ["", "unknown"],
  ])("%s → %s", (message, bucket) => {
    expect(saveErrorClass(message)).toBe(bucket);
  });

  it("checks the network bucket first, as both arms did", () => {
    expect(saveErrorClass("fetch failed: permission denied")).toBe("network");
  });
});
