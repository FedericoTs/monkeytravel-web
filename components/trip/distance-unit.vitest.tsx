import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TravelSegment } from "@/hooks/useTravelDistances";

// The viewer's distance unit, as LocaleProvider gives it.
const viewer = vi.hoisted(() => ({ unit: "imperial" as "metric" | "imperial" }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/locale", async (orig) => {
  const real = await orig<typeof import("@/lib/locale")>();
  return {
    ...real,
    useLocale: () => ({ preferences: { distanceUnit: viewer.unit } }),
    useDistance: () => ({ convert: (m: number) => real.formatDistance(m, viewer.unit), unit: viewer.unit }),
  };
});

import { TravelConnector } from "./TravelConnector";
import { DaySummary } from "./DaySummary";

describe("a travel leg's distance", () => {
  it("is in the viewer's unit even when the leg carries a metric text", () => {
    viewer.unit = "imperial";
    render(<TravelConnector segment={{ distanceMeters: 3218.7, distanceText: "3.2 km", durationText: "12 min", mode: "DRIVING" }} />);
    expect(screen.getByText("2.0 mi")).toBeTruthy();
    expect(screen.queryByText("3.2 km")).toBeNull();
  });

  it("keeps an estimate's ~", () => {
    viewer.unit = "metric";
    render(<TravelConnector segment={{ distanceMeters: 850, distanceText: "~850 m", durationText: "~11 min", mode: "WALKING" }} />);
    expect(screen.getByText("~850 m")).toBeTruthy();
  });

  it("falls back to the leg's text when the metres are unknown", () => {
    viewer.unit = "imperial";
    render(<TravelConnector segment={{ durationSeconds: 1200, distanceText: "~5 km", durationText: "~20 min", mode: "DRIVING" }} />);
    expect(screen.getByText("~5 km")).toBeTruthy();
  });
});

describe("a day's travel total", () => {
  it("is in the viewer's unit", () => {
    viewer.unit = "imperial";
    const segment = { fromActivityId: "a", toActivityId: "b", distanceMeters: 20000, durationSeconds: 1200, mode: "DRIVING" } as TravelSegment;
    render(<DaySummary dayNumber={1} segments={[segment]} activities={[]} pace="moderate" />);
    expect(screen.getAllByText("12 mi").length).toBeGreaterThan(0);
    expect(screen.queryByText(/km/)).toBeNull();
  });
});
