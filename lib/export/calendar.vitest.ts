/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateICS } from "./calendar";

// A trip day is a calendar date. West of UTC, reading "2026-10-01" as UTC
// midnight put every event on the day before.
describe("calendar export west of UTC", () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Chicago";
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it("keeps each activity on its day", () => {
    const ics = generateICS({
      title: "Lisbon",
      itinerary: [
        {
          day_number: 1,
          date: "2026-10-01",
          activities: [
            {
              name: "Tram 28",
              description: "Ride the old tram",
              type: "attraction",
              start_time: "10:00",
              duration_minutes: 90,
              location: "Graça",
            },
          ],
        },
      ],
    } as never);

    expect(ics).toContain("DTSTART:20261001T100000");
    expect(ics).toContain("DTEND:20261001T113000");
  });
});
