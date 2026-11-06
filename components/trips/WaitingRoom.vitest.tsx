import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import itCommon from "@/messages/it/common.json";
import esCommon from "@/messages/es/common.json";
import ptCommon from "@/messages/pt/common.json";
import type { WaitingRoomTrip } from "@/lib/trips/waiting-room";

const capture = vi.fn();
vi.mock("@/lib/posthog", () => ({ capture: (...args: unknown[]) => capture(...args) }));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

import WaitingRoom from "./WaitingRoom";

const words = enCommon.waitingRoom;
const TRIP: WaitingRoomTrip = {
  id: "t1",
  title: "Lisbon",
  startDate: "2026-12-07",
  endDate: "2026-12-11",
  pencilled: false,
  highlights: ["Tram 28 through Alfama", "Belém at opening"],
  packing: ["Adapter", "Rain jacket"],
  firstStop: "São Jorge Castle",
};

const show = (trip: Partial<WaitingRoomTrip> = {}, today = "2026-11-06", holdout = false) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }} timeZone="UTC">
      <WaitingRoom trip={{ ...TRIP, ...trip }} today={today} holdout={holdout} />
    </NextIntlClientProvider>,
  );

const text = () => screen.getByTestId("waiting-room").textContent ?? "";

beforeEach(() => capture.mockReset());
afterEach(cleanup);

describe("the trip at the top of the home", () => {
  it("names it, with its dates and the days to go", () => {
    show();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Lisbon");
    expect(text()).toContain("31");
    expect(text()).toContain("days to go");
    expect(text()).toMatch(/Dec/);
  });

  it("says day, not days, for the last one", () => {
    show({}, "2026-12-06");
    expect(text()).toContain("day to go");
    expect(text()).not.toContain("days to go");
  });

  it("links to the trip", () => {
    show();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/trips/t1");
  });
});

describe("what sits under it", () => {
  it("far out: what they're going for", () => {
    show({}, "2026-11-06");
    expect(text()).toContain(words.whileYouWait);
    expect(text()).toContain("Tram 28 through Alfama");
    expect(screen.getByRole("link").textContent).toBe(words.lookThrough);
  });

  it("weeks out: what to pack", () => {
    show({}, "2026-11-20");
    expect(text()).toContain(words.worthSorting);
    expect(text()).toContain("Adapter");
    expect(text()).not.toContain("Tram 28");
    expect(screen.getByRole("link").textContent).toBe(words.packingList);
  });

  it("weeks out with no packing list: what they're going for", () => {
    show({ packing: [] }, "2026-11-20");
    expect(text()).toContain(words.whileYouWait);
    expect(text()).toContain("Tram 28");
  });

  it("days out: how the first day starts", () => {
    show({}, "2026-12-03");
    expect(text()).toContain(words.beforeYouGo);
    expect(text()).toContain("Day one starts with São Jorge Castle.");
    expect(screen.getByRole("link").textContent).toBe(words.openDayOne);
  });

  it("days out with no first stop: just the way in", () => {
    show({ firstStop: null }, "2026-12-03");
    expect(text()).not.toContain(words.beforeYouGo);
    expect(text()).not.toContain("Day one starts");
    expect(screen.getByRole("link").textContent).toBe(words.openDayOne);
  });

  it("under way: which day it is, with no countdown", () => {
    show({}, "2026-12-08");
    expect(text()).toContain("Day 2 of 5");
    expect(text()).not.toContain("to go");
    expect(screen.getByRole("link").textContent).toBe(words.openToday);
  });

  it("with nothing to say, still offers the way in", () => {
    show({ highlights: [], packing: [], firstStop: null });
    expect(screen.queryByRole("list")).toBeNull();
    expect(text()).not.toContain(words.whileYouWait);
    expect(screen.getByRole("link").textContent).toBe(words.lookThrough);
  });
});

describe("dates that are only a placeholder", () => {
  it("count down to nothing, and ask for real ones", () => {
    show({ pencilled: true });
    expect(text()).not.toContain("to go");
    expect(text()).toContain(words.datesNote);
    expect(screen.getByRole("link").textContent).toBe(words.setDates);
  });
});

describe("the holdout", () => {
  it("sees nothing, and is counted", () => {
    show({}, "2026-11-06", true);
    expect(screen.queryByTestId("waiting-room")).toBeNull();
    expect(capture).toHaveBeenCalledWith("waiting_room_seen", { arm: "holdout", stage: "far", pencilled: false });
  });
});

describe("what's recorded", () => {
  it("that it was seen, once, and at which stage", () => {
    const { rerender } = show({}, "2026-11-20");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ common: enCommon }} timeZone="UTC">
        <WaitingRoom trip={TRIP} today="2026-11-21" />
      </NextIntlClientProvider>,
    );
    expect(capture.mock.calls).toEqual([["waiting_room_seen", { arm: "shown", stage: "weeks", pencilled: false }]]);
  });

  it("the card's click", () => {
    show({}, "2026-12-03");
    fireEvent.click(screen.getByRole("link"));
    expect(capture).toHaveBeenCalledWith("waiting_room_card_clicked", { stage: "days", pencilled: false });
  });
});

describe("the words", () => {
  it.each([
    ["it", itCommon, "giorni alla partenza"],
    ["es", esCommon, "días para salir"],
    ["pt", ptCommon, "dias para a viagem"],
  ])("are in %s", (locale, messages, phrase) => {
    render(
      <NextIntlClientProvider locale={locale} messages={{ common: messages }} timeZone="UTC">
        <WaitingRoom trip={TRIP} today="2026-11-06" />
      </NextIntlClientProvider>,
    );
    expect(text()).toContain(phrase);
  });
});
