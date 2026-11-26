/** @vitest-environment node */
/**
 * Keeping a visit's other places (lib/wizard/visit-trips.ts, hooks/useKeepVisitTrips.ts) in the planner: the box that
 * keeps a plan marks them when it opens (every way in goes through openKeepAuth), and once the planner is signed in
 * and the plan on screen saved, they follow it. Asserted against the source: the planner is too big to render for
 * one branch.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "NewTripWizard.tsx"), "utf8").replace(/\r/g, "");
const openAt = SRC.indexOf("const openKeepAuth = (location: AuthPromptLocation) => {");
const openKeepAuth = SRC.slice(openAt, SRC.indexOf("\n  };", openAt));

describe("keeping the visit's other places", () => {
  it("marks them when the box that keeps a plan opens, from the tray, besides the place on screen", () => {
    expect(openAt).toBeGreaterThan(-1);
    expect(openKeepAuth).toContain(
      "markVisitToKeep(otherPlacesOfVisit(sessionTrips, { destination, itinerary: generatedItinerary }).map((trip) => trip.id));"
    );
  });

  it("saves them once the planner is signed in and the plan on screen is saved", () => {
    expect(SRC).toContain(
      "useKeepVisitTrips({ trips: sessionTrips, userId: authUser?.id ?? null, currentSaved: Boolean(savedTripId), locale });"
    );
  });
});
