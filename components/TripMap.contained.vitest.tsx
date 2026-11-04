import { describe, expect, it, vi, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ItineraryDay } from "@/types";

/**
 * Sentry JAVASCRIPT-NEXTJS-26/-27: on iOS Safari @react-google-maps/api built
 * a map against a dead ref and threw, and the route's error page replaced the
 * whole shared trip. Only the shared view caught it. The map renders on the
 * trip page, the wizard's result and the template preview too, so it now
 * catches its own throw.
 */

const reportBoundaryError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/report-boundary-error", () => ({ reportBoundaryError }));
vi.mock("@react-google-maps/api", () => ({
  useJsApiLoader: () => ({ isLoaded: true, loadError: undefined }),
  GoogleMap: () => {
    throw new Error("map ref was not an Element");
  },
  Marker: () => null,
  InfoWindow: () => null,
  Polyline: () => null,
  OverlayView: Object.assign(() => null, { OVERLAY_MOUSE_TARGET: "overlayMouseTarget" }),
}));

const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
afterAll(() => consoleError.mockRestore());

import TripMap from "./TripMap";

const common = JSON.parse(readFileSync(join(process.cwd(), "messages", "en", "common.json"), "utf8"));
const days = [
  {
    day_number: 1,
    date: "2027-05-10",
    activities: [
      { id: "a1", name: "Louvre", type: "attraction", time_slot: "morning", coordinates: { lat: 48.8606, lng: 2.3376 } },
      { id: "a2", name: "Orsay", type: "attraction", time_slot: "afternoon", coordinates: { lat: 48.86, lng: 2.3266 } },
    ],
  },
] as unknown as ItineraryDay[];

describe("TripMap", () => {
  it("shows its own 'failed to load' box when the maps library throws, and the page around it stays", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ common }}>
        <TripMap days={days} destination="Paris" className="h-[400px]" disableApiCalls />
        <p>Day 1: Louvre, Orsay</p>
      </NextIntlClientProvider>
    );
    expect(screen.getByText(common.map.failedToLoad)).toBeTruthy();
    expect(screen.getByText("Day 1: Louvre, Orsay")).toBeTruthy();
    expect(reportBoundaryError).toHaveBeenCalledWith(expect.objectContaining({ message: "map ref was not an Element" }), "trip-map");
  });
});
