import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import enTrips from "@/messages/en/trips.json";
import type { Activity } from "@/types";

vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `${from} ${amount}` }) }),
  useLocale: () => ({ preferences: { distanceUnit: "km" } }),
  formatDistance: (meters: number) => `${meters} m`,
}));
const opened: string[] = [];
vi.mock("@/lib/native/external-link", () => ({ openExternal: (url: string) => void opened.push(url) }));

import StopRow, { StopRows, hasStopNote } from "./StopRow";

const orsay = (over: Partial<Activity> = {}) =>
  ({
    id: "a1",
    name: "Musée d'Orsay",
    type: "museum",
    description: "Impressionists in a converted railway station.",
    location: "7th arrondissement",
    address: "1 Rue de la Légion d'Honneur, 75007 Paris",
    start_time: "09:00",
    time_slot: "morning",
    duration_minutes: 180,
    booking_required: true,
    tips: [],
    estimated_cost: { amount: 17, currency: "EUR", tier: "budget" },
    image_url: "/api/images/wikimedia/abc-500.jpg?a=X&l=CC0&f=Y.jpg",
    ...over,
  }) as Activity;

const show = (activity: Activity, extra?: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon, trips: enTrips }}>
      <StopRows label="Day 1">
        <StopRow activity={activity} currency="EUR" extra={extra} />
      </StopRows>
    </NextIntlClientProvider>,
  );

afterEach(() => {
  cleanup();
  opened.length = 0;
});

describe("a stop's row on a phone", () => {
  it("says when, how long, what, what kind and about how much, in one row", () => {
    show(orsay());
    const row = screen.getByRole("button", { name: /Musée d'Orsay/ });
    expect(row.textContent).toContain("09:00");
    expect(row.textContent).toContain("3 h");
    expect(row.textContent).toContain("Museum");
    expect(row.textContent).toContain("Booking");
    // An estimate is marked as one.
    expect(row.textContent).toContain("~EUR 17");
    // The description and the address wait in the sheet.
    expect(row.textContent).not.toContain("Impressionists");
    expect(row.textContent).not.toContain("Rue de la Légion");
  });

  it("says a free stop is free, with no estimate mark, and nothing for a stop with no price", () => {
    show(orsay({ estimated_cost: { amount: 0, currency: "EUR", tier: "free" } }));
    expect(screen.getByRole("button", { name: /Musée d'Orsay/ }).textContent).toContain("Free");
    expect(screen.getByRole("button", { name: /Musée d'Orsay/ }).textContent).not.toContain("~");
    cleanup();
    show(orsay({ estimated_cost: undefined }));
    expect(screen.getByRole("button", { name: /Musée d'Orsay/ }).textContent).not.toMatch(/EUR|Free|~/);
  });

  it("leaves out a length of zero and a booking that isn't needed", () => {
    show(orsay({ duration_minutes: 0, booking_required: false }));
    const row = screen.getByRole("button", { name: /Musée d'Orsay/ });
    expect(row.textContent).not.toContain("·");
    expect(row.textContent).not.toContain("Booking");
  });

  it("shows the stop's picture small and unnamed, and its kind's mark when it has none", () => {
    const { container } = show(orsay());
    const picture = container.querySelector("li img");
    expect(picture?.getAttribute("alt")).toBe("");
    expect(picture?.getAttribute("loading")).toBe("lazy");
    cleanup();
    const plain = show(orsay({ image_url: undefined }));
    expect(plain.container.querySelector("li img")).toBeNull();
    expect(screen.getByRole("button", { name: /Musée d'Orsay/ }).textContent).toContain("🏛️");
  });

  it("gives way to the kind's mark when the picture no longer loads", () => {
    const { container } = show(orsay());
    fireEvent.error(container.querySelector("li img")!);
    expect(container.querySelector("li img")).toBeNull();
    expect(container.querySelector('li [aria-hidden="true"]')?.textContent).toBe("🏛️");
  });

  it("says a stop's length alone when it has no time", () => {
    show(orsay({ start_time: "" }));
    const row = screen.getByRole("button", { name: /Musée d'Orsay/ });
    expect(row.textContent).toContain("3 h");
    expect(row.textContent).not.toContain(" · 3 h");
  });

  it("opens the stop's sheet on a tap, where the rest is", () => {
    show(orsay());
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Musée d'Orsay/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Musée d'Orsay" })).toBeTruthy();
    expect(sheet.textContent).toContain("Impressionists in a converted railway station.");
    expect(sheet.textContent).toContain("1 Rue de la Légion d'Honneur");
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks a fixed plan", () => {
    show(orsay({ locked: true }));
    expect(screen.getByRole("img", { name: enCommon.lockedActivity })).toBeTruthy();
  });

  it("carries the row's place in the page, for a map pin to find", () => {
    const { container } = show(orsay());
    const item = container.querySelector("li");
    expect(item?.id).toBeTruthy();
    expect(item?.getAttribute("data-activity-name")).toBe("Musée d'Orsay");
  });
});

describe("what can't wait for a tap", () => {
  it("keeps a closing day on the row, with its own link beside the row's button, not inside it", () => {
    show(orsay({ closing: { dates: ["2027-05-10"], source: "https://www.musee-orsay.fr/en/visit/hours" } }));
    const row = screen.getByRole("button", { name: /Musée d'Orsay/ });
    expect(row.textContent).not.toContain("Closed");
    const source = screen.getByRole("button", { name: "Official hours" });
    expect(row.contains(source)).toBe(false);
    fireEvent.click(source);
    expect(opened).toEqual(["https://www.musee-orsay.fr/en/visit/hours"]);
    // The link opened the hours, not the sheet.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the note of a place not found on the map, and whose pick it is", () => {
    show(orsay({ unverified: true, picked_by: "Lina" } as Partial<Activity>));
    expect(screen.getByText(enCommon.activity.unverified)).toBeTruthy();
    expect(screen.getByText("Lina's pick")).toBeTruthy();
  });

  it("shows what the page adds under a stop, outside the row's button", () => {
    show(orsay(), <button type="button">{"I'd skip this"}</button>);
    const row = screen.getByRole("button", { name: /Musée d'Orsay/ });
    expect(row.contains(screen.getByRole("button", { name: "I'd skip this" }))).toBe(false);
  });

  it("adds nothing under a stop with no note", () => {
    const { container } = show(orsay());
    expect(container.querySelector("li")?.children.length).toBe(1);
  });

  it("knows which stops carry a note", () => {
    expect(hasStopNote({})).toBe(false);
    expect(hasStopNote({ unverified: true })).toBe(true);
    expect(hasStopNote({ picked_by: "  " })).toBe(false);
    expect(hasStopNote({ picked_by: "Lina" })).toBe(true);
    expect(hasStopNote({ closing: { dates: [], source: "https://x.example" } })).toBe(false);
    expect(hasStopNote({ closing: { dates: ["2027-05-10"], source: "https://x.example" } })).toBe(true);
  });
});

describe("a day's rows", () => {
  it("are one list named for the day", () => {
    show(orsay());
    const list = screen.getByRole("list", { name: "Day 1" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });
});
