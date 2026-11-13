import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import type { KeptPlan } from "@/lib/plans/kept-plan";
import type { GeneratedItinerary } from "@/types";

const openKeptPlan = vi.fn();
const isItinerarySaved = vi.fn();
const capture = vi.fn();
vi.mock("@/lib/plans/kept-plans-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plans/kept-plans-client")>()),
  openKeptPlan: (...a: unknown[]) => openKeptPlan(...a),
}));
vi.mock("@/lib/wizard/draft-saved-check", () => ({ isItinerarySaved: (...a: unknown[]) => isItinerarySaved(...a) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/posthog/events", () => ({ capture: (...a: unknown[]) => capture(...a) }));

import { readKeptPlans, rememberKeptPlan } from "@/lib/plans/kept-plans-client";
import { useKeptPlanOpening } from "./useKeptPlanOpening";

const TOKEN = "T".repeat(22);
const OTHER = "U".repeat(22);
const EXPIRES = "2099-01-01T00:00:00.000Z";
const itinerary = {
  destination: { name: "Lisbon" },
  trip_summary: {},
  days: [
    { day_number: 1, activities: [] },
    { day_number: 2, activities: [] },
  ],
} as unknown as GeneratedItinerary;
// Its own pace and wish; no vibes or budget, so the screen's are kept.
const plan: KeptPlan = {
  destination: "Lisbon, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-11",
  itinerary,
  pace: "relaxed",
  mustDos: ["Tram 28"],
};

const targets = () => ({
  setDestination: vi.fn(),
  setStartDate: vi.fn(),
  setEndDate: vi.fn(),
  setPace: vi.fn(),
  setSelectedVibes: vi.fn(),
  setBudgetTier: vi.fn(),
  setMustDos: vi.fn(),
  setDietary: vi.fn(),
  setTravelStyle: vi.fn(),
  setAnchors: vi.fn(),
  setTripIntent: vi.fn(),
  setFlexibleDates: vi.fn(),
  setStay: vi.fn(),
  setGeneratedItinerary: vi.fn(),
  registerRestore: vi.fn(),
});

type Props = Parameters<typeof useKeptPlanOpening>[0];
let draftTargets = targets();
const router = { push: vi.fn() };
const adoptOpenedPlan = vi.fn();
const setShowDraftRecovery = vi.fn();
const setDestinationCoords = vi.fn();
const setMultiCityMode = vi.fn();
const props = (over: Partial<Props> = {}): Props => ({
  isAuthenticated: false,
  authUser: null,
  router,
  adoptOpenedPlan,
  setShowDraftRecovery,
  draftTargets,
  setDestinationCoords,
  setMultiCityMode,
  pace: "moderate",
  selectedVibes: ["foodie"],
  budgetTier: "balanced",
  tripIntent: "unspecified",
  ...over,
});
const entry = (token: string) => ({
  token,
  destination: plan.destination,
  startDate: plan.startDate,
  endDate: plan.endDate,
  dayCount: 2,
  expiresAt: EXPIRES,
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/trips/new");
  draftTargets = targets();
  [openKeptPlan, isItinerarySaved, capture, router.push, adoptOpenedPlan, setShowDraftRecovery].forEach((fn) =>
    fn.mockReset()
  );
  openKeptPlan.mockResolvedValue({ plan, expiresAt: EXPIRES });
  isItinerarySaved.mockResolvedValue(false);
});

describe("useKeptPlanOpening", () => {
  it("takes a plan's link off the address bar at once, and opens it once sign-in state is known", async () => {
    window.history.replaceState(null, "", `/trips/new?ref=mail#plan=${TOKEN}`);
    const { rerender } = renderHook((p: Props) => useKeptPlanOpening(p), {
      initialProps: props({ isAuthenticated: null }),
    });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?ref=mail");
    await act(() => Promise.resolve());
    expect(openKeptPlan).not.toHaveBeenCalled();

    rerender(props({ isAuthenticated: false }));
    await waitFor(() => expect(draftTargets.setGeneratedItinerary).toHaveBeenCalledWith(itinerary));
    expect(openKeptPlan.mock.calls).toEqual([[TOKEN]]);
    expect(isItinerarySaved).not.toHaveBeenCalled();
    expect(adoptOpenedPlan).toHaveBeenCalledWith(TOKEN, plan, EXPIRES);
    expect(setShowDraftRecovery).toHaveBeenCalledWith(false);
    expect(readKeptPlans()).toEqual([entry(TOKEN)]);
    expect(capture).toHaveBeenCalledWith("kept_plan_opened", { source: "link" });
    // The plan's own answers, and the screen's where it has none.
    expect(draftTargets.setPace).toHaveBeenCalledWith("relaxed");
    expect(draftTargets.setMustDos).toHaveBeenCalledWith(["Tram 28"]);
    expect(draftTargets.registerRestore).toHaveBeenCalledWith(
      expect.objectContaining({ pace: "relaxed", vibes: ["foodie"], budgetTier: "balanced" })
    );
  });

  it("opens a link pasted into the open tab", async () => {
    renderHook(() => useKeptPlanOpening(props()));
    await act(() => Promise.resolve());
    expect(openKeptPlan).not.toHaveBeenCalled();

    act(() => {
      window.history.replaceState(null, "", `/trips/new#plan=${TOKEN}`);
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(draftTargets.setGeneratedItinerary).toHaveBeenCalledWith(itinerary));
    expect(openKeptPlan.mock.calls).toEqual([[TOKEN]]);
  });

  it("says an expired plan is gone and forgets it, until another plan opens", async () => {
    rememberKeptPlan(entry(TOKEN));
    rememberKeptPlan(entry(OTHER));
    openKeptPlan.mockResolvedValueOnce("gone");
    const { result } = renderHook(() => useKeptPlanOpening(props()));
    expect(result.current.keptPlans.map((e) => e.token)).toEqual([OTHER, TOKEN]);

    await act(() => result.current.handleOpenKeptPlan(TOKEN, "list"));
    expect(result.current.keptPlanGone).toBe(true);
    expect(result.current.keptPlans.map((e) => e.token)).toEqual([OTHER]);
    expect(draftTargets.setGeneratedItinerary).not.toHaveBeenCalled();

    await act(() => result.current.handleOpenKeptPlan(OTHER, "list"));
    expect(result.current.keptPlanGone).toBe(false);
    expect(capture).toHaveBeenCalledWith("kept_plan_opened", { source: "list" });
  });

  it("signed in, takes a plan already among the planner's trips to them instead", async () => {
    isItinerarySaved.mockResolvedValue(true);
    const user = { id: "u1" } as User;
    const { result } = renderHook(() => useKeptPlanOpening(props({ isAuthenticated: true, authUser: user })));

    await act(() => result.current.handleOpenKeptPlan(TOKEN, "list"));
    expect(isItinerarySaved).toHaveBeenCalledWith(expect.anything(), "u1", itinerary);
    expect(router.push).toHaveBeenCalledWith("/trips");
    expect(draftTargets.setGeneratedItinerary).not.toHaveBeenCalled();
    expect(readKeptPlans()).toEqual([]);
  });

  it("shows which plan is opening, and changes nothing when it cannot be read", async () => {
    let answer!: (value: null) => void;
    openKeptPlan.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useKeptPlanOpening(props()));

    let opening!: Promise<void>;
    act(() => {
      opening = result.current.handleOpenKeptPlan(TOKEN, "list");
    });
    expect(result.current.openingKeptPlan).toBe(TOKEN);
    await act(async () => {
      answer(null);
      await opening;
    });
    expect(result.current.openingKeptPlan).toBeNull();
    expect(result.current.keptPlanGone).toBe(false);
    expect(draftTargets.setGeneratedItinerary).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});
