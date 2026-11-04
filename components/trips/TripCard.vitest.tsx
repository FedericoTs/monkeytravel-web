import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import TripCard, { type Trip } from "./TripCard";

/**
 * A trip on My Trips: its cover (stored, else looked up by destination) and
 * its actions menu.
 */

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: "t1",
  title: "Lisbon Trip",
  start_date: "2026-12-01",
  end_date: "2026-12-04",
  status: "planning",
  created_at: "2026-11-01T10:00:00Z",
  ...over,
});

function show(t: Trip, onAction = vi.fn()) {
  render(
    <TripCard trip={t} t={(key) => key} locale="en" getStatusLabel={(s) => `status:${s}`} onAction={onAction} />
  );
  return onAction;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TripCard", () => {
  it("shows a stored cover without looking one up", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    show(trip({ cover_image_url: "https://images.example/lisbon.jpg" }));
    expect(screen.getByRole("img", { name: "Lisbon Trip" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks a cover up by the destination in the title when none is stored", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ url: "https://images.example/found.jpg" })));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      show(trip());
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/images/destination?destination=Lisbon");
    expect(screen.getByRole("img", { name: "Lisbon Trip" })).toBeTruthy();
  });

  it("offers archiving and deleting a trip, and unarchiving an archived one", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onAction = show(trip({ cover_image_url: "https://images.example/lisbon.jpg" }));
    fireEvent.click(screen.getAllByRole("button", { name: "tripActions" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "archiveTrip" }));
    expect(onAction).toHaveBeenLastCalledWith("t1", "Lisbon Trip", "archive");
    fireEvent.click(screen.getAllByRole("button", { name: "tripActions" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "deleteTrip" }));
    expect(onAction).toHaveBeenLastCalledWith("t1", "Lisbon Trip", "delete");
    cleanup();

    const onArchived = show(trip({ is_archived: true, cover_image_url: "https://images.example/lisbon.jpg" }));
    fireEvent.click(screen.getAllByRole("button", { name: "tripActions" })[0]);
    expect(screen.queryByRole("menuitem", { name: "archiveTrip" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "unarchiveTrip" }));
    expect(onArchived).toHaveBeenLastCalledWith("t1", "Lisbon Trip", "unarchive");
  });
});
