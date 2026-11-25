/** @vitest-environment node */
/**
 * A proposal for one day of a trip through several cities searches that day's
 * city, as the day's own add-activity panel does (components/trip/TripDayList.vitest.tsx).
 * Asserted against the source, as the page needs a signed-in session to render.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "TripDetailClient.tsx"), "utf8");
const at = SRC.indexOf("<ProposeActivitySheet");
const sheet = SRC.slice(at, SRC.indexOf("/>", at));

describe("proposing a place for a day", () => {
  it("searches the city of the day it is for", () => {
    expect(at).toBeGreaterThan(-1);
    expect(sheet).toMatch(
      /destination=\{placeOfDay\(\s*displayItinerary\.find\(\(day\) => day\.day_number === proposeModalState\.targetDay\),\s*destination\s*\)\}/
    );
    expect(SRC).toMatch(/import \{ getTripDestination, placeOfDay \} from "@\/lib\/trips\/destination";/);
  });
});
