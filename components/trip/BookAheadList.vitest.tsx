/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";
import type { ItineraryDay } from "@/types";

/**
 * "Book ahead" lists what the plan says needs a booking, with a link to book
 * from, and keeps the "Booked" ticks on the trip.
 */

const db = vi.hoisted(() => ({
  meta: {} as Record<string, unknown>,
  writes: [] as Array<Record<string, unknown>>,
  refuse: false,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { trip_meta: db.meta }, error: null }) }) }),
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          select: async () => {
            if (db.refuse) return { data: [], error: null };
            db.writes.push(values);
            db.meta = values.trip_meta as Record<string, unknown>;
            return { data: [{ id: "trip-1" }], error: null };
          },
        }),
      }),
    }),
  }),
}));

import BookAheadList from "./BookAheadList";

const stop = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, start_time: "10:00", booking_required: false, ...extra });
const itinerary = [
  {
    day_number: 1,
    date: "2026-12-01",
    activities: [
      stop("a1", "Breakfast"),
      stop("a2", "Sagrada Família", { booking_required: true, start_time: "11:00", official_website: "https://sagradafamilia.org" }),
    ],
  },
  { day_number: 2, date: "2026-12-02", activities: [stop("b1", "Flamenco show", { booking_required: true, start_time: "21:00" })] },
] as unknown as ItineraryDay[];

function show(days: ItineraryDay[] = itinerary, booked: string[] = []) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
      <BookAheadList tripId="trip-1" itinerary={days} initialBooked={booked} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  db.meta = { packing_checked: ["passport"] };
  db.writes.length = 0;
  db.refuse = false;
});

afterEach(cleanup);

describe("BookAheadList", () => {
  it("lists what needs booking by date, with a link to book from where there is one", () => {
    show();
    const list = screen.getByTestId("book-ahead");
    expect(within(list).getByText("Book ahead")).toBeTruthy();
    expect(within(list).getByText("0 of 2 booked")).toBeTruthy();
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByRole("checkbox").getAttribute("aria-label"))).toEqual([
      "Booked: Sagrada Família",
      "Booked: Flamenco show",
    ]);
    expect(rows[0].textContent).toContain("Day 1 · Tue, Dec 1 · 11:00");
    expect(within(rows[0]).getByRole("link", { name: "Book online" }).getAttribute("href")).toBe("https://sagradafamilia.org");
    expect(within(rows[1]).queryByRole("link")).toBeNull();
    expect(screen.queryByText("Breakfast")).toBeNull();
  });

  it("keeps a tick on the trip, next to what the trip already holds", async () => {
    show();
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Booked: Flamenco show" }));
    });
    expect(screen.getByText("1 of 2 booked")).toBeTruthy();
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].trip_meta).toEqual({ packing_checked: ["passport"], booked_ids: ["b1"] });
  });

  it("shows the ticks the trip kept, and unticking keeps that too", async () => {
    show(itinerary, ["a2", "gone-from-the-plan"]);
    expect(screen.getByText("1 of 2 booked")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Booked: Sagrada Família" }));
    });
    expect(db.writes[0].trip_meta).toMatchObject({ booked_ids: [] });
  });

  it("says when a tick couldn't be kept, and puts it back", async () => {
    db.refuse = true;
    show();
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Booked: Flamenco show" }));
    });
    expect(screen.getByRole("alert").textContent).toBe(common.bookAhead.saveFailed);
    expect((screen.getByRole("checkbox", { name: "Booked: Flamenco show" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("0 of 2 booked")).toBeTruthy();
  });

  // The trip page keeps the list behind a chip, which shows this count.
  it("tells how many stops are ticked, at first and after each tick", async () => {
    const told: number[] = [];
    const onProgress = (booked: number) => {
      told.push(booked);
    };
    render(
      <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
        <BookAheadList tripId="trip-1" itinerary={itinerary} initialBooked={["a2"]} onProgress={onProgress} />
      </NextIntlClientProvider>,
    );
    expect(told).toEqual([1]);
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Booked: Flamenco show" }));
    });
    expect(told).toEqual([1, 2]);
  });

  it("shows nothing for a plan with nothing to book", () => {
    const { container } = show([{ day_number: 1, date: "2026-12-01", activities: [stop("a1", "Breakfast")] }] as unknown as ItineraryDay[]);
    expect(container.innerHTML).toBe("");
  });
});
