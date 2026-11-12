import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import { BOOKED_IDS_MAX, bookAheadStops, readBookedIds } from "./book-ahead";

/**
 * The trip's "Book ahead" list: the stops the plan marks as needing a booking,
 * in the order they happen, each with a safe link to book from.
 */

const stop = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, start_time: "10:00", booking_required: false, ...extra });
const day = (day_number: number, activities: unknown[], date = `2026-12-0${day_number}`) =>
  ({ day_number, date, activities }) as unknown as ItineraryDay;

describe("bookAheadStops", () => {
  it("lists the stops that need booking, day by day in the plan's order, with their day and time", () => {
    const days = [
      day(2, [stop("b1", "Alhambra", { booking_required: true, start_time: "09:00", official_website: "https://alhambra-patronato.es" })]),
      day(1, [
        stop("a1", "Breakfast"),
        stop("a2", "Sagrada Família", { booking_required: true, start_time: "11:00", official_website: "https://sagradafamilia.org" }),
        stop("a3", "Flamenco show", { booking_required: true, start_time: "21:00", booking_url: "https://tablao.example/tickets" }),
      ]),
    ];
    expect(bookAheadStops(days)).toEqual([
      { id: "a2", name: "Sagrada Família", dayNumber: 1, date: "2026-12-01", startTime: "11:00", link: "https://sagradafamilia.org" },
      { id: "a3", name: "Flamenco show", dayNumber: 1, date: "2026-12-01", startTime: "21:00", link: "https://tablao.example/tickets" },
      { id: "b1", name: "Alhambra", dayNumber: 2, date: "2026-12-02", startTime: "09:00", link: "https://alhambra-patronato.es" },
    ]);
  });

  it("books from the official site first, and only over https", () => {
    const [both, plain, none] = bookAheadStops([
      day(1, [
        stop("x", "Both", { booking_required: true, official_website: "https://official.example", booking_url: "https://reseller.example" }),
        stop("y", "Plain", { booking_required: true, official_website: "http://old.example", booking_url: "javascript:alert(1)" }),
        stop("z", "None", { booking_required: true }),
      ]),
    ]);
    expect(both.link).toBe("https://official.example");
    expect(plain.link).toBeUndefined();
    expect(none.link).toBeUndefined();
  });

  it("leaves out stops with no id, and lists a stop once", () => {
    const required = { booking_required: true };
    expect(
      bookAheadStops([
        day(1, [{ name: "No id", booking_required: true }, stop("same", "Twice", required)]),
        day(2, [stop("same", "Twice", required)]),
      ]).map((s) => s.id)
    ).toEqual(["same"]);
  });

  it("is empty for a plan with nothing to book, or no plan", () => {
    expect(bookAheadStops([day(1, [stop("a", "Walk")])])).toEqual([]);
    expect(bookAheadStops([])).toEqual([]);
    expect(bookAheadStops([{ day_number: 1, activities: null } as unknown as ItineraryDay])).toEqual([]);
  });
});

describe("readBookedIds", () => {
  it("reads the ticks kept on the trip, and only real ones", () => {
    expect(readBookedIds({ booked_ids: ["a", "b", 3, "", "a"] })).toEqual(["a", "b"]);
    expect(readBookedIds({ booked_ids: Array.from({ length: BOOKED_IDS_MAX + 5 }, (_, i) => `s${i}`) })).toHaveLength(BOOKED_IDS_MAX);
    for (const meta of [null, undefined, {}, { booked_ids: "a" }]) expect(readBookedIds(meta)).toEqual([]);
  });
});
