import { describe, it, expect } from "vitest";
import { seasonalStayWindow } from "./seasonal-window";

/**
 * The only thing that can really go wrong here is handing Hostelworld a date
 * range that has already passed, which turns a results page into an error.
 * Every case below is a way that happens.
 */
describe("seasonalStayWindow", () => {
  const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it("uses this year when the month is still ahead", () => {
    expect(seasonalStayWindow("where-to-go-in-december", on("2026-08-26")))
      .toEqual({ start: "2026-12-10", end: "2026-12-14" });
  });

  it("rolls to next year once the month has passed", () => {
    // Reading the October guide in December must not point at a dead October.
    expect(seasonalStayWindow("where-to-go-in-october", on("2026-12-01")))
      .toEqual({ start: "2027-10-10", end: "2027-10-14" });
  });

  it("stays in the current year while the reader is inside that month", () => {
    // The 12th is still October. Comparing on the window START would have
    // rolled this a year forward and quietly killed the link.
    expect(seasonalStayWindow("where-to-go-in-october", on("2026-10-12")))
      .toEqual({ start: "2026-10-10", end: "2026-10-14" });
  });

  it("rolls forward once the window itself has passed mid-month", () => {
    expect(seasonalStayWindow("where-to-go-in-october", on("2026-10-15")))
      .toEqual({ start: "2027-10-10", end: "2027-10-14" });
  });

  it("returns null for a post with no single month", () => {
    // The monsoon guide spans a season across many countries. There is no
    // honest window, so it gets no stay CTA rather than an invented one.
    expect(seasonalStayWindow("monsoon-season-where-to-go-and-avoid", on("2026-08-26"))).toBeNull();
  });

  it("does not match a month name hiding inside another word", () => {
    // "maybe" contains "may"; a substring match would have produced a window.
    expect(seasonalStayWindow("maybe-visit-somewhere", on("2026-08-26"))).toBeNull();
  });

  it("pads single-digit months so the date stays ISO", () => {
    const w = seasonalStayWindow("where-to-go-in-march", on("2026-01-05"));
    expect(w).toEqual({ start: "2026-03-10", end: "2026-03-14" });
  });

  it("handles a December read in late December by rolling to next year", () => {
    expect(seasonalStayWindow("where-to-go-in-december", on("2026-12-20")))
      .toEqual({ start: "2027-12-10", end: "2027-12-14" });
  });
});
