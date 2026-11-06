import { describe, expect, it } from "vitest";
import { homeTrip, inWaitingRoom, waitingRoomTrip, waitingStage } from "./waiting-room";

const TODAY = "2026-11-06";
const trip = (id: string, start_date: string, end_date: string, more: Record<string, unknown> = {}) => ({
  id,
  title: `${id} Trip`,
  start_date,
  end_date,
  status: "planning",
  is_archived: false,
  ...more,
});

describe("what changes with the distance to departure", () => {
  it.each([
    [90, "far"],
    [31, "far"],
    [30, "weeks"],
    [7, "weeks"],
    [6, "days"],
    [1, "days"],
    [0, "during"],
    [-2, "during"],
  ])("%i days to go is %s", (days, stage) => {
    expect(waitingStage(days)).toBe(stage);
  });
});

describe("the trip the home is about", () => {
  it("is the next to start", () => {
    const next = homeTrip([trip("later", "2027-03-01", "2027-03-05"), trip("next", "2026-12-01", "2026-12-05"), trip("past", "2026-01-01", "2026-01-05")], TODAY);
    expect(next?.id).toBe("next");
  });

  it("is one under way, ahead of one coming", () => {
    const next = homeTrip([trip("next", "2026-11-08", "2026-11-10"), trip("now", "2026-11-04", "2026-11-06")], TODAY);
    expect(next?.id).toBe("now");
  });

  it("counts a trip that starts today as under way", () => {
    expect(homeTrip([trip("today", TODAY, "2026-11-08")], TODAY)?.id).toBe("today");
  });

  it("reads dates that come with a time", () => {
    expect(homeTrip([trip("next", "2026-12-01T00:00:00+00:00", "2026-12-05T00:00:00+00:00")], TODAY)?.id).toBe("next");
  });

  it.each([
    ["only past trips", [trip("past", "2026-01-01", "2026-01-05")]],
    ["a cancelled trip", [trip("x", "2026-12-01", "2026-12-05", { status: "cancelled" })]],
    ["an archived trip", [trip("x", "2026-12-01", "2026-12-05", { is_archived: true })]],
    ["a trip with no dates", [trip("x", "", "")]],
    ["no trips", []],
  ])("is none with %s", (_name, trips) => {
    expect(homeTrip(trips, TODAY)).toBeNull();
  });
});

describe("the holdout", () => {
  const ids = Array.from({ length: 4000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("keeps an account on one side", () => {
    for (const id of ids.slice(0, 50)) expect(inWaitingRoom(id)).toBe(inWaitingRoom(id));
  });

  it("sends about one in ten to the holdout", () => {
    const held = ids.filter((id) => !inWaitingRoom(id)).length / ids.length;
    expect(held).toBeGreaterThan(0.07);
    expect(held).toBeLessThan(0.13);
  });
});

describe("what the page gets", () => {
  const base = { id: "t1", title: "Lisbon Trip", start_date: "2026-12-01T00:00:00Z", end_date: "2026-12-05T00:00:00Z" };

  it("names the place and takes what the read found", () => {
    expect(
      waitingRoomTrip(base, {
        highlights: ["Tram 28", "", 3, "Belém", "Alfama", "Fourth"],
        packing: ["Adapter"],
        pencilled: null,
        day1: { activities: [{ name: " Castle " }, { name: "Lunch" }] },
      }),
    ).toEqual({
      id: "t1",
      title: "Lisbon",
      startDate: "2026-12-01",
      endDate: "2026-12-05",
      pencilled: false,
      highlights: ["Tram 28", "Belém", "Alfama"],
      packing: ["Adapter"],
      firstStop: "Castle",
    });
  });

  it("is bare when the read failed or the plan has none of it", () => {
    for (const read of [null, {}, { highlights: "x", packing: 3, day1: "x" }, { day1: { activities: [] } }, { day1: { activities: [null] } }]) {
      expect(waitingRoomTrip(base, read)).toMatchObject({ highlights: [], packing: [], firstStop: null, pencilled: false });
    }
  });

  it("knows dates that are still the pencilled ones, and ones chosen since", () => {
    expect(waitingRoomTrip(base, { pencilled: { start: "2026-12-01", end: "2026-12-05" } }).pencilled).toBe(true);
    expect(waitingRoomTrip(base, { pencilled: { start: "2026-11-01", end: "2026-11-05" } }).pencilled).toBe(false);
  });

  it("keeps a title that's only the word Trip", () => {
    expect(waitingRoomTrip({ ...base, title: "Trip" }, null).title).toBe("Trip");
    expect(waitingRoomTrip({ ...base, title: " Trip" }, null).title).toBe(" Trip");
  });
});
