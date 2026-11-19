import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import type { ItineraryDay } from "@/types";

/**
 * A stop pinned far from every other stop of its day (a same-name place elsewhere, or coordinates written wrong)
 * gets no pin: the map fits the day's other stops instead of zooming out to a country, or the world. The maps
 * library is faked; the points the map fits are read from its bounds.
 */

const fitted: Array<{ lat: number; lng: number }> = [];
const fakeMap = { getZoom: () => 13, fitBounds: () => {}, panTo: () => {} };
vi.mock("@/hooks/useMediaQuery", () => ({ useIsPhone: () => false }));
vi.mock("@/lib/observability/report-boundary-error", () => ({ reportBoundaryError: vi.fn() }));
vi.mock("@react-google-maps/api", () => ({
  useJsApiLoader: () => ({ isLoaded: true, loadError: undefined }),
  GoogleMap: ({ children, onLoad }: { children: ReactNode; onLoad: (m: unknown) => void }) => {
    queueMicrotask(() => onLoad(fakeMap));
    return <div>{children}</div>;
  },
  Marker: () => null,
  InfoWindow: () => null,
  Polyline: () => null,
  OverlayView: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, { OVERLAY_MOUSE_TARGET: "overlayMouseTarget" }),
}));
vi.stubGlobal("google", {
  maps: {
    LatLngBounds: class {
      extend(point: { lat: number; lng: number }) {
        fitted.push(point);
      }
    },
    SymbolPath: { CIRCLE: 0 },
  },
});

const { default: TripMap } = await import("./TripMap");

const common = JSON.parse(readFileSync(join(process.cwd(), "messages", "en", "common.json"), "utf8"));
const stop = (id: string, lat: number, lng: number) => ({ id, name: id, type: "attraction", time_slot: "morning", start_time: "09:00", coordinates: { lat, lng } });

async function show(days: ItineraryDay[]) {
  render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      <TripMap days={days} destination="Barcelona" className="h-[400px]" disableApiCalls />
    </NextIntlClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  fitted.length = 0;
});
afterEach(cleanup);

describe("a stop pinned far from the rest of its day", () => {
  it("gets no pin, so the map fits the day's other stops", async () => {
    await show([
      {
        day_number: 1,
        date: "2027-05-10",
        activities: [stop("Sagrada Familia", 40.354, -3.714), stop("Boqueria", 41.382, 2.172), stop("La Rambla", 41.381, 2.173)],
      },
    ] as unknown as ItineraryDay[]);
    expect(fitted.length).toBeGreaterThan(0);
    expect(fitted.every((p) => p.lat > 41)).toBe(true);
    expect(fitted).toContainEqual({ lat: 41.382, lng: 2.172 });
  });

  it("keeps it when its day has stops near it", async () => {
    await show([
      {
        day_number: 1,
        date: "2027-05-10",
        activities: [stop("Prado", 40.414, -3.692), stop("Retiro", 40.415, -3.684), stop("Boqueria", 41.382, 2.172), stop("La Rambla", 41.381, 2.173)],
      },
    ] as unknown as ItineraryDay[]);
    expect(fitted).toContainEqual({ lat: 40.414, lng: -3.692 });
    expect(fitted).toContainEqual({ lat: 41.382, lng: 2.172 });
  });
});
