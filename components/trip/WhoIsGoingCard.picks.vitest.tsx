/** @vitest-environment jsdom */
/**
 * Below "Who's going", the owner sees what each person going through the link
 * doesn't want to miss, and one button that adds to the plan what it doesn't
 * hold yet, in the page's save queue, with Undo. The places are invented.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WhoIsGoingCard from "./WhoIsGoingCard";
import type { OwnerParticipant, OwnerPicks } from "@/lib/participants/shared";
import type { ItineraryDay } from "@/types";
import { ItineraryWriteBlockedError } from "@/lib/trips/itinerary-sync";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  useLocale: () => "en",
}));

const owner: OwnerParticipant = {
  id: "owner-1",
  display_name: "Olive",
  role: "owner",
  going: true,
  in_split: true,
  has_account: true,
  has_email: false,
  joined_at: null,
  participant_id: null,
};

const PLAN = [
  { day_number: 1, date: "2027-04-10", activities: [{ id: "a1", name: "Hillside Botanical Garden", type: "attraction", start_time: "10:00", duration_minutes: 90 }] },
] as unknown as ItineraryDay[];
const FITTED = [
  {
    day_number: 1,
    date: "2027-04-10",
    activities: [...PLAN[0].activities, { id: "a2", name: "Granja La Cremosa", type: "food", start_time: "16:30", duration_minutes: 45, picked_by: "Bo" }],
  },
] as unknown as ItineraryDay[];

const picksOf = (over: Partial<OwnerPicks> = {}): OwnerPicks => ({
  participant_id: "row-g",
  display_name: "Bo",
  picks: ["Granja La Cremosa", "Hillside Botanical Garden"],
  picks_at: "2027-03-01T10:00:00Z",
  picks_placed_at: null,
  ...over,
});

type Reply = { status?: number; body?: unknown };
function serve(picks: OwnerPicks[], replies: Record<string, Reply[]> = {}) {
  const calls: Array<{ call: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = `${init?.method ?? "GET"} ${url}`;
      calls.push({ call, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (call === "GET /api/trips/trip-1/participants") {
        return new Response(JSON.stringify({ count: 1, participants: [owner], picks }), { status: 200 });
      }
      const reply = replies[call]?.shift() ?? { body: {} };
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
    }),
  );
  return calls;
}

// The page's save queue runs the task; `runs` counts the writes it was given.
const write = () => {
  const runs = vi.fn();
  const run = <T,>(task: () => Promise<T>): Promise<T> => (runs(), task());
  const adopt = vi.fn();
  return { run, runs, adopt };
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FIT_CALL = "POST /api/trips/trip-1/participants/row-g/fit";
const fittedReply = { body: { data: { added: ["Granja La Cremosa"], notFitted: [], itinerary: FITTED, previousItinerary: PLAN, fromVersion: 7, itineraryVersion: 8 } } };

describe("what people going don't want to miss", () => {
  it("lists each person's must-dos under their name, or as someone going without one", async () => {
    serve([picksOf(), picksOf({ participant_id: "row-n", display_name: null, picks: ["Lighthouse Point"] })]);
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} />);
    expect(await screen.findByText('share.participants.fit.title {"name":"Bo"}')).toBeTruthy();
    expect(screen.getByText("share.participants.fit.titleNoName")).toBeTruthy();
    expect(screen.getByText("Granja La Cremosa")).toBeTruthy();
    expect(screen.getByText("Lighthouse Point")).toBeTruthy();
  });

  it("offers to add them only when the plan lacks one, they're new since the last time, and the page can write", async () => {
    const { run, adopt } = write();
    serve([picksOf()]);
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
    expect(await screen.findByRole("button", { name: "share.participants.fit.button" })).toBeTruthy();
    cleanup();

    serve([picksOf({ picks: ["Hillside Botanical Garden"] })]);
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
    await screen.findByText("Hillside Botanical Garden");
    expect(screen.queryByRole("button", { name: "share.participants.fit.button" })).toBeNull();
    cleanup();

    serve([picksOf({ picks_placed_at: "2027-03-02T10:00:00Z" })]);
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
    await screen.findByText("Granja La Cremosa");
    expect(screen.queryByRole("button", { name: "share.participants.fit.button" })).toBeNull();
    cleanup();

    // Picks sent again after they were fitted are offered again.
    serve([picksOf({ picks_placed_at: "2027-02-01T10:00:00Z" })]);
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
    expect(await screen.findByRole("button", { name: "share.participants.fit.button" })).toBeTruthy();
    cleanup();

    serve([picksOf()]);
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} />);
    await screen.findByText("Granja La Cremosa");
    expect(screen.queryByRole("button", { name: "share.participants.fit.button" })).toBeNull();
  });

  it("adds them in the page's save queue, gives the page the stored plan at its version, and says what went in", async () => {
    const { run, runs, adopt } = write();
    const calls = serve([picksOf()], { [FIT_CALL]: [fittedReply] });
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
    fireEvent.click(await screen.findByRole("button", { name: "share.participants.fit.button" }));
    expect(await screen.findByText(/share\.participants\.fit\.added \{"list":"Granja La Cremosa"\}/)).toBeTruthy();
    expect(runs).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.call)).toContain(FIT_CALL);
    expect(adopt).toHaveBeenCalledWith(FITTED, 8);
    // Fitted: not offered again.
    expect(screen.queryByRole("button", { name: "share.participants.fit.button" })).toBeNull();
  });

  it("says which had no place, and changes nothing when none went in", async () => {
    const { run, adopt } = write();
    serve([picksOf()], { [FIT_CALL]: [{ body: { added: [], notFitted: ["Granja La Cremosa"], itinerary: null } }] });
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
    fireEvent.click(await screen.findByRole("button", { name: "share.participants.fit.button" }));
    expect(await screen.findByText('share.participants.fit.noPlace {"list":"Granja La Cremosa"}')).toBeTruthy();
    expect(adopt).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "share.participants.fit.undo" })).toBeNull();
  });

  it("undoes onto the version it wrote, gives the page the old plan, and offers them again", async () => {
    const { run, runs, adopt } = write();
    const calls = serve([picksOf()], {
      [FIT_CALL]: [fittedReply],
      "POST /api/ai/assistant/undo": [{ body: { data: { success: true, restoredItinerary: PLAN, itineraryVersion: 9 } } }],
    });
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
    fireEvent.click(await screen.findByRole("button", { name: "share.participants.fit.button" }));
    fireEvent.click(await screen.findByRole("button", { name: "share.participants.fit.undo" }));
    expect(await screen.findByText("share.participants.fit.undone")).toBeTruthy();
    const undo = calls.find((c) => c.call === "POST /api/ai/assistant/undo");
    expect(undo?.body).toEqual({ tripId: "trip-1", previousItinerary: PLAN, expectedVersion: 8 });
    expect(adopt).toHaveBeenLastCalledWith(PLAN, 9);
    expect(runs).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.call)).toContain("DELETE /api/trips/trip-1/participants/row-g/fit");
    expect(screen.getByRole("button", { name: "share.participants.fit.button" })).toBeTruthy();
  });

  it("says why when it couldn't: busy, a blocked write, or anything else", async () => {
    for (const [reply, shown] of [
      [{ status: 409, body: {} }, "share.participants.fit.busy"],
      [{ status: 503, body: {} }, "share.participants.fit.failed"],
    ] as const) {
      const { run, adopt } = write();
      serve([picksOf()], { [FIT_CALL]: [reply] });
      render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
      fireEvent.click(await screen.findByRole("button", { name: "share.participants.fit.button" }));
      expect((await screen.findByRole("alert")).textContent).toBe(shown);
      expect(adopt).not.toHaveBeenCalled();
      cleanup();
    }

    const adopt = vi.fn();
    const blocked = async <T,>(): Promise<T> => {
      throw new ItineraryWriteBlockedError("Save your changes first");
    };
    serve([picksOf()]);
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={blocked} onItineraryChange={adopt} />);
    fireEvent.click(await screen.findByRole("button", { name: "share.participants.fit.button" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Save your changes first");
  });

  it("says when Undo is too late because the plan changed since", async () => {
    const { run, adopt } = write();
    serve([picksOf()], { [FIT_CALL]: [fittedReply], "POST /api/ai/assistant/undo": [{ status: 409, body: {} }] });
    render(<WhoIsGoingCard tripId="trip-1" itinerary={PLAN} runItineraryWrite={run} onItineraryChange={adopt} />);
    fireEvent.click(await screen.findByRole("button", { name: "share.participants.fit.button" }));
    fireEvent.click(await screen.findByRole("button", { name: "share.participants.fit.undo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("share.participants.fit.undoFailed");
    expect(adopt).toHaveBeenCalledTimes(1);
  });
});
