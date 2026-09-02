// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLAIMED_TRIP_EVENT,
  CLAIMED_TRIP_KEY,
  clearClaimedTrip,
  onClaimedTrip,
  publishClaimedTrip,
  readClaimedTrip,
} from "./claimed-trip-signal";

afterEach(() => {
  clearClaimedTrip();
  vi.restoreAllMocks();
});

describe("claimed-trip signal", () => {
  it("a wizard that mounts AFTER the claim still finds the id", () => {
    publishClaimedTrip("trip-9");
    expect(readClaimedTrip()).toBe("trip-9");
    expect(sessionStorage.getItem(CLAIMED_TRIP_KEY)).toBe("trip-9");
  });

  it("a wizard that is ALREADY listening hears the claim", () => {
    const seen: string[] = [];
    const off = onClaimedTrip((id) => seen.push(id));
    publishClaimedTrip("trip-4");
    off();
    publishClaimedTrip("trip-5");
    expect(seen).toEqual(["trip-4"]);
  });

  it("clear forgets the id so the hand-off shows once", () => {
    publishClaimedTrip("trip-1");
    clearClaimedTrip();
    expect(readClaimedTrip()).toBeNull();
  });

  it("ignores a malformed event and never throws", () => {
    const seen: string[] = [];
    const off = onClaimedTrip((id) => seen.push(id));
    window.dispatchEvent(new CustomEvent(CLAIMED_TRIP_EVENT, { detail: {} }));
    window.dispatchEvent(new Event(CLAIMED_TRIP_EVENT));
    off();
    expect(seen).toEqual([]);
  });

  it("survives a browser with storage blocked (this runs inside sign-in)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const seen: string[] = [];
    const off = onClaimedTrip((id) => seen.push(id));
    expect(() => publishClaimedTrip("trip-2")).not.toThrow();
    off();
    // Storage failed, but the live channel still delivered.
    expect(seen).toEqual(["trip-2"]);
  });
});
