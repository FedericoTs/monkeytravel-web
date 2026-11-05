import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ItineraryDay } from "@/types";
import { useItineraryCopies } from "./useItineraryCopies";

const stored = [
  { day_number: 1, activities: [{ name: "Alfama" }, { id: "act_kept", name: "Belem" }] },
] as unknown as ItineraryDay[];

const open = (id = "trip-1") => renderHook(() => useItineraryCopies({ id, itinerary: stored })).result.current;
const ids = (days: ItineraryDay[]) => days[0].activities.map((a) => a.id);

describe("the trip page's two copies of its plan", () => {
  it("match when the trip was stored without ids, so nothing looks edited on the first render", () => {
    const { initialItinerary, editedItinerary } = open();
    expect(JSON.stringify(editedItinerary)).toBe(JSON.stringify(initialItinerary));
    expect(ids(initialItinerary)[0]).toMatch(/^act_/);
  });

  it("have the same ids on every mount, and keep an id that was stored", () => {
    expect(ids(open().initialItinerary)).toEqual(ids(open().initialItinerary));
    expect(ids(open().initialItinerary)[1]).toBe("act_kept");
  });

  it("derive their ids from the trip", () => {
    expect(ids(open("trip-1").initialItinerary)[0]).not.toBe(ids(open("trip-2").initialItinerary)[0]);
  });

  it("don't share anything: a change to the edited copy leaves the other as loaded", () => {
    const { initialItinerary, editedItinerary } = open();
    editedItinerary[0].activities[0].name = "Changed";
    expect(initialItinerary[0].activities[0].name).toBe("Alfama");
  });
});
