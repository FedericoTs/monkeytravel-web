import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { followsTripClock, localDayStart, localMorningReached, LOOKAHEAD_HOURS, rowIsDue, zoneOfDayOne } from "./local-morning";

/**
 * A trip's emails go out at 07:00 where the trip is, not at 07:00 UTC: "today's
 * plan" arriving mid-afternoon in Tokyo, or at 20:00 the evening before in
 * Honolulu, is the wrong email at the wrong time.
 */

const at = (iso: string) => new Date(iso);

describe("localMorningReached", () => {
  it("is 07:00 on the row's day in the trip's zone", () => {
    // Tokyo is UTC+9: 07:00 on 10 March is 22:00 UTC on 9 March.
    expect(localMorningReached("2027-03-10", "Asia/Tokyo", at("2027-03-09T21:59:00Z"))).toBe(false);
    expect(localMorningReached("2027-03-10", "Asia/Tokyo", at("2027-03-09T22:00:00Z"))).toBe(true);
    // Honolulu is UTC-10: 07:00 on 10 March is 17:00 UTC on 10 March.
    expect(localMorningReached("2027-03-10", "Pacific/Honolulu", at("2027-03-10T16:59:00Z"))).toBe(false);
    expect(localMorningReached("2027-03-10", "Pacific/Honolulu", at("2027-03-10T17:00:00Z"))).toBe(true);
  });

  it("stays reached for the rest of that day and after it", () => {
    expect(localMorningReached("2027-03-10", "Europe/Lisbon", at("2027-03-10T23:30:00Z"))).toBe(true);
    expect(localMorningReached("2027-03-10", "Europe/Lisbon", at("2027-03-12T02:00:00Z"))).toBe(true);
  });

  it("is never reached the day before, however late", () => {
    expect(localMorningReached("2027-03-10", "Europe/Lisbon", at("2027-03-09T23:59:00Z"))).toBe(false);
  });

  it("follows the clock change", () => {
    // Lisbon moves to UTC+1 on 28 March 2027: 07:00 that morning is 06:00 UTC.
    expect(localMorningReached("2027-03-28", "Europe/Lisbon", at("2027-03-28T05:59:00Z"))).toBe(false);
    expect(localMorningReached("2027-03-28", "Europe/Lisbon", at("2027-03-28T06:00:00Z"))).toBe(true);
  });

  it("works in half-hour zones and at both ends of the date line", () => {
    // Kolkata is UTC+5:30: 07:00 is 01:30 UTC.
    expect(localMorningReached("2027-03-22", "Asia/Kolkata", at("2027-03-22T01:29:00Z"))).toBe(false);
    expect(localMorningReached("2027-03-22", "Asia/Kolkata", at("2027-03-22T01:30:00Z"))).toBe(true);
    // Kiritimati is UTC+14: 07:00 on 10 March is 17:00 UTC on 9 March.
    expect(localMorningReached("2027-03-10", "Pacific/Kiritimati", at("2027-03-09T17:00:00Z"))).toBe(true);
    // Pago Pago is UTC-11: 07:00 on 10 March is 18:00 UTC on 10 March.
    expect(localMorningReached("2027-03-10", "Pacific/Pago_Pago", at("2027-03-10T17:59:00Z"))).toBe(false);
  });
});

describe("LOOKAHEAD_HOURS", () => {
  it("reaches the earliest local morning before its 06:00 UTC stamp", () => {
    // The zone furthest east, UTC+14, reaches 07:00 thirteen hours before 06:00 UTC.
    expect(LOOKAHEAD_HOURS).toBeGreaterThanOrEqual(13);
    expect(localMorningReached("2027-03-10", "Pacific/Kiritimati", at("2027-03-09T17:00:00Z"))).toBe(true);
    expect(Date.parse("2027-03-10T06:00:00Z") - Date.parse("2027-03-09T17:00:00Z")).toBeLessThanOrEqual(LOOKAHEAD_HOURS * 3_600_000);
  });
});

describe("the notifications cron", () => {
  it("runs every hour, so every zone's morning has a run", () => {
    // Once a day, a day email for Honolulu would wait until its day had begun, and be refused as late.
    const { crons } = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(crons.find((c) => c.path === "/api/cron/scheduled-notifications")?.schedule).toBe("0 * * * *");
  });
});

describe("followsTripClock", () => {
  it("is the pre-trip reminders and the day emails", () => {
    for (const slot of ["pack_early_14d", "visa_check_7d", "weather_3d", "confirm_1d", "morning_of", "in_trip_day_2", "in_trip_day_9"]) {
      expect(followsTripClock(slot), slot).toBe(true);
    }
  });

  it("isn't what comes after the trip, when the traveller is home in a zone we don't know", () => {
    for (const slot of ["followup_return_3d", "followup_review_7d", "finish_trip_1d", "something_new"]) {
      expect(followsTripClock(slot), slot).toBe(false);
    }
  });
});

describe("zoneOfDayOne", () => {
  it("is the zone of the first stop with coordinates", () => {
    const day = { day_number: 1, activities: [{ name: "Check in" }, { name: "Senso-ji", coordinates: { lat: 35.7148, lng: 139.7967 } }] };
    expect(zoneOfDayOne(day)).toBe("Asia/Tokyo");
  });

  it("is none without coordinates or a day", () => {
    expect(zoneOfDayOne({ day_number: 1, activities: [{ name: "Somewhere" }] })).toBeNull();
    expect(zoneOfDayOne({ day_number: 1, activities: [{ name: "Null island", coordinates: { lat: 0, lng: 0 } }] })).toBeNull();
    expect(zoneOfDayOne(null)).toBeNull();
    expect(zoneOfDayOne("junk")).toBeNull();
  });
});

describe("localDayStart", () => {
  it("is local midnight of the trip's today, as an instant", () => {
    // 07:30 on 10 March in Tokyo: the day began at 15:00 UTC on 9 March.
    expect(localDayStart("Asia/Tokyo", at("2027-03-09T22:30:00Z"))).toBe("2027-03-09T15:00:00.000Z");
    // 07:05 on 10 March in Honolulu: the day began at 10:00 UTC on 10 March.
    expect(localDayStart("Pacific/Honolulu", at("2027-03-10T17:05:00Z"))).toBe("2027-03-10T10:00:00.000Z");
    // Kolkata, UTC+5:30.
    expect(localDayStart("Asia/Kolkata", at("2027-03-22T02:00:00Z"))).toBe("2027-03-21T18:30:00.000Z");
  });

  it("holds on the days the clocks change", () => {
    // Lisbon springs forward at 01:00 UTC on 28 March: that day began at 00:00 UTC.
    expect(localDayStart("Europe/Lisbon", at("2027-03-28T12:00:00Z"))).toBe("2027-03-28T00:00:00.000Z");
    // And falls back on 31 October: that day began at 23:00 UTC on the 30th, still on summer time.
    expect(localDayStart("Europe/Lisbon", at("2027-10-31T12:00:00Z"))).toBe("2027-10-30T23:00:00.000Z");
  });

  it("holds where the clocks change far from UTC, and where they change at midnight", () => {
    // Sydney springs forward at 02:00 on 3 October 2027: that day began at 00:00 AEST, 14:00 UTC on the 2nd.
    expect(localDayStart("Australia/Sydney", at("2027-10-03T00:00:00Z"))).toBe("2027-10-02T14:00:00.000Z");
    // And falls back at 03:00 on 4 April 2027: that day began at 00:00 AEDT, 13:00 UTC on the 3rd.
    expect(localDayStart("Australia/Sydney", at("2027-04-04T02:00:00Z"))).toBe("2027-04-03T13:00:00.000Z");
    // Santiago skips from midnight to 01:00 on 5 September 2027: that day began at 01:00, 04:00 UTC.
    expect(localDayStart("America/Santiago", at("2027-09-05T15:00:00Z"))).toBe("2027-09-05T04:00:00.000Z");
  });
});

describe("rowIsDue", () => {
  const stamp = "2027-03-10T06:00:00+00:00";

  it("follows the trip's clock where the trip's zone is known", () => {
    const row = { slot: "in_trip_day_2", scheduled_for: stamp };
    expect(rowIsDue(row, "Asia/Tokyo", at("2027-03-09T22:30:00Z"))).toBe(true);
    expect(rowIsDue(row, "Pacific/Honolulu", at("2027-03-10T06:30:00Z"))).toBe(false);
  });

  it("keeps its stamp where the zone isn't known", () => {
    const row = { slot: "in_trip_day_2", scheduled_for: stamp };
    expect(rowIsDue(row, null, at("2027-03-10T05:59:00Z"))).toBe(false);
    expect(rowIsDue(row, null, at("2027-03-10T06:00:00Z"))).toBe(true);
  });

  it("keeps its stamp after the trip, whatever the zone", () => {
    const row = { slot: "followup_return_3d", scheduled_for: stamp };
    expect(rowIsDue(row, "Asia/Tokyo", at("2027-03-09T22:30:00Z"))).toBe(false);
    expect(rowIsDue(row, "Asia/Tokyo", at("2027-03-10T06:00:00Z"))).toBe(true);
  });
});
