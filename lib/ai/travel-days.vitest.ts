import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import { travelDaysFit } from "./travel-days";

/**
 * Whether a plan's first and last day fit when they arrive and leave: the stops before they can be there, and after
 * they must be gone. The journey itself never counts.
 */

const stop = (start_time: string, name: string, type = "attraction", duration_minutes = 90) =>
  ({ start_time, name, type, duration_minutes }) as unknown as ItineraryDay["activities"][number];
const days = [
  { day_number: 1, date: "2027-04-10", activities: [stop("09:00", "Colosseum"), stop("19:00", "Airport transfer to the hotel", "transport", 60), stop("19:45", "Trattoria Da Enzo", "restaurant")] },
  { day_number: 2, date: "2027-04-11", activities: [stop("09:00", "Vatican Museums")] },
  { day_number: 3, date: "2027-04-12", activities: [stop("08:30", "Breakfast at Roscioli", "cafe", 45), stop("10:00", "Trevi Fountain", "landmark", 30), stop("11:00", "Check-out", "accommodation", 15)] },
] as unknown as ItineraryDay[];

describe("travelDaysFit", () => {
  it("counts the first day's stops before they can be there, never the journey", () => {
    expect(travelDaysFit(days, { arrival: { when: "evening", date: "2027-04-10" } })).toEqual({ arrival: "evening", early: 1, late: 0 });
    expect(travelDaysFit(days, { arrival: { when: "morning", date: "2027-04-10" } })).toEqual({ arrival: "morning", early: 1, late: 0 });
    // Late at night, the whole day is the journey: dinner counts too.
    expect(travelDaysFit(days, { arrival: { when: "night", date: "2027-04-10" } })).toEqual({ arrival: "night", early: 2, late: 0 });
  });

  it("counts the last day's stops still going after they must be gone, never the way out", () => {
    // Breakfast ends 09:15: inside a morning departure. The fountain ends 10:30: after it.
    expect(travelDaysFit(days, { departure: { when: "morning", date: "2027-04-12" } })).toEqual({ departure: "morning", early: 0, late: 1 });
    expect(travelDaysFit(days, { departure: { when: "afternoon", date: "2027-04-12" } })).toEqual({ departure: "afternoon", early: 0, late: 0 });
  });

  it("counts a visit that starts in time but runs past the leaving", () => {
    const lastDay = [{ day_number: 3, date: "2027-04-12", activities: [stop("12:00", "Pantheon", "landmark", 90)] }] as unknown as ItineraryDay[];
    expect(travelDaysFit(lastDay, { departure: { when: "afternoon", date: "2027-04-12" } })?.late).toBe(1);
    const shorter = [{ day_number: 3, date: "2027-04-12", activities: [stop("12:00", "Pantheon", "landmark", 45)] }] as unknown as ItineraryDay[];
    expect(travelDaysFit(shorter, { departure: { when: "afternoon", date: "2027-04-12" } })?.late).toBe(0);
  });

  it("leaves nothing but the arrival on a night arrival, even a late dinner", () => {
    const night = [{ day_number: 1, date: "2027-04-10", activities: [stop("21:30", "Late supper", "restaurant", 60)] }] as unknown as ItineraryDay[];
    expect(travelDaysFit(night, { arrival: { when: "night", date: "2027-04-10" } })?.early).toBe(1);
    expect(travelDaysFit(night, { arrival: { when: "evening", date: "2027-04-10" } })?.early).toBe(0);
  });

  it("allows a quarter of an hour either side", () => {
    const tight = [{ day_number: 1, date: "2027-04-10", activities: [stop("19:15", "Trattoria Da Enzo", "restaurant")] }] as unknown as ItineraryDay[];
    expect(travelDaysFit(tight, { arrival: { when: "evening", date: "2027-04-10" } })?.early).toBe(0);
    const tighter = [{ day_number: 1, date: "2027-04-10", activities: [stop("19:14", "Trattoria Da Enzo", "restaurant")] }] as unknown as ItineraryDay[];
    expect(travelDaysFit(tighter, { arrival: { when: "evening", date: "2027-04-10" } })?.early).toBe(1);
  });

  it("counts nothing for a day the plan doesn't hold, and is null when neither was asked", () => {
    expect(travelDaysFit(days, { arrival: { when: "evening", date: "2027-05-01" } })).toEqual({ arrival: "evening", early: 0, late: 0 });
    expect(travelDaysFit(days, {})).toBeNull();
  });
});
