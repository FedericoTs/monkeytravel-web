import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import type { ItineraryDay } from "@/types";

/**
 * The map's day buttons: on a phone they stay off Google's logo, which has to stay
 * visible, and the pins stay off them. The maps library is faked, so where the row
 * lands is read from its classes. They say, in the page's language, which day they
 * are, which one is picked and what a tap does.
 */

const fitBounds = vi.fn();
const fakeMap = { getZoom: () => 13, fitBounds, panTo: () => {} };
let isPhone = true;
vi.mock("@/hooks/useMediaQuery", () => ({ useIsPhone: () => isPhone }));
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
vi.stubGlobal("google", { maps: { LatLngBounds: class { extend() {} }, SymbolPath: { CIRCLE: 0 } } });

const { default: TripMap } = await import("./TripMap");

const commonIn = (locale: string) => JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8"));
const stop = (id: string, lat: number, lng: number) => ({ id, name: id, type: "attraction", time_slot: "morning", start_time: "09:00", coordinates: { lat, lng } });
const days = [
  { day_number: 1, date: "2027-05-10", activities: [stop("Louvre", 48.8606, 2.3376)] },
  { day_number: 2, date: "2027-05-11", activities: [stop("Bastille", 48.8532, 2.3692)] },
] as unknown as ItineraryDay[];

async function show(locale = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={{ common: commonIn(locale) }}>
      <TripMap days={days} destination="Paris" className="h-[400px]" disableApiCalls />
    </NextIntlClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const lastFit = () => fitBounds.mock.calls.at(-1)?.[1];

beforeEach(() => {
  isPhone = true;
  fitBounds.mockClear();
});
afterEach(cleanup);

describe("the map's fit", () => {
  it("keeps a phone's pins above the day buttons", async () => {
    await show();
    expect(lastFit()).toEqual({ top: 50, right: 50, bottom: 100, left: 50 });
  });

  it("is even all round on a larger screen, where the buttons are in a corner", async () => {
    isPhone = false;
    await show();
    expect(lastFit()).toEqual({ top: 50, right: 50, bottom: 50, left: 50 });
  });

  it("still does when a day is picked", async () => {
    await show();
    fitBounds.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Day 2" }));
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(lastFit().bottom).toBe(100);
  });
});

describe("the day buttons", () => {
  it("sit in a row as wide as they are, centred above Google's logo", async () => {
    await show();
    const row = screen.getByRole("button", { name: "Day 1" }).parentElement!.parentElement!;
    for (const name of ["bottom-8", "left-1/2", "-translate-x-1/2", "w-max"]) {
      expect(row.className.split(" ")).toContain(name);
    }
  });

  it("are the size they say on touch, not the touch rule's", async () => {
    await show();
    const { className } = screen.getByRole("button", { name: "Day 1" });
    for (const name of ["min-h-0!", "min-w-0!", "pointer-coarse:w-8", "pointer-coarse:h-8"]) {
      expect(className.split(" ")).toContain(name);
    }
  });

  it("say which day they are, and which one is picked", async () => {
    await show();
    const first = screen.getByRole("button", { name: "Day 1" });
    const second = screen.getByRole("button", { name: "Day 2" });
    expect(first.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(first);
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(second.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(first);
    expect(first.getAttribute("aria-pressed")).toBe("false");
  });

  it("speak the page's language", async () => {
    await show("it");
    const first = screen.getByRole("button", { name: "Giorno 1" });
    expect(first.title).toBe("Mostra solo il giorno 1");
    fireEvent.click(first);
    expect(first.title).toBe("Mostra tutti i giorni");
  });
});
