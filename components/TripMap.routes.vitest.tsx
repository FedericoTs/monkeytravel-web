import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import type { ItineraryDay } from "@/types";

/**
 * A route's travel times on the map: each sized to its text, and only those with
 * room, so they don't sit on the pins or on each other. The maps library is faked;
 * the label rule is real.
 */

let zoom = 13;
let zoomChanged: (() => void) | undefined;
vi.mock("@/lib/observability/report-boundary-error", () => ({ reportBoundaryError: vi.fn() }));
vi.mock("@react-google-maps/api", () => ({
  useJsApiLoader: () => ({ isLoaded: true, loadError: undefined }),
  GoogleMap: ({ children, onLoad, onZoomChanged }: { children: ReactNode; onLoad: (m: unknown) => void; onZoomChanged: () => void }) => {
    zoomChanged = onZoomChanged;
    queueMicrotask(() => onLoad(fakeMap));
    return <div data-testid="map">{children}</div>;
  },
  Marker: () => null,
  InfoWindow: () => null,
  Polyline: () => null,
  OverlayView: Object.assign(({ children }: { children: ReactNode }) => <div data-testid="overlay">{children}</div>, { OVERLAY_MOUSE_TARGET: "overlayMouseTarget" }),
}));
const fakeMap = { getZoom: () => zoom, fitBounds: () => {}, panTo: () => {} };
vi.stubGlobal("google", { maps: { LatLngBounds: class { extend() {} }, SymbolPath: { CIRCLE: 0 } } });
vi.stubEnv("NEXT_PUBLIC_MAP_ROUTES_ENABLED", "true");

const { default: TripMap } = await import("./TripMap");

const common = JSON.parse(readFileSync(join(process.cwd(), "messages", "en", "common.json"), "utf8"));
const stop = (id: string, slot: string, lat: number, lng: number) => ({ id, name: id, type: "attraction", time_slot: slot, start_time: "09:00", coordinates: { lat, lng } });
const days = [
  {
    day_number: 1,
    date: "2027-05-10",
    activities: [stop("Louvre", "morning", 48.8606, 2.3376), stop("Bastille", "afternoon", 48.8606, 2.3876), stop("Next door", "evening", 48.8606, 2.3886)],
  },
] as unknown as ItineraryDay[];

async function show(atZoom: number) {
  zoom = atZoom;
  render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      <TripMap days={days} destination="Paris" className="h-[400px]" disableApiCalls />
    </NextIntlClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    zoomChanged?.();
  });
}

afterEach(cleanup);

describe("a route's travel times on the map", () => {
  it("only on legs with room for them at this zoom", async () => {
    await show(13);
    expect(screen.getAllByTestId("overlay")).toHaveLength(1);
  });

  it("more of them when zoomed in", async () => {
    await show(13);
    zoom = 18;
    await act(async () => {
      zoomChanged?.();
    });
    expect(screen.getAllByTestId("overlay")).toHaveLength(2);
  });

  it("as wide as their text and centred on the leg, in the map's 0×0 box", async () => {
    await show(13);
    const pill = screen.getByTestId("overlay").firstElementChild as HTMLElement;
    for (const name of ["w-max", "-translate-x-1/2", "-translate-y-1/2", "whitespace-nowrap"]) {
      expect(pill.className).toContain(name);
    }
  });
});
