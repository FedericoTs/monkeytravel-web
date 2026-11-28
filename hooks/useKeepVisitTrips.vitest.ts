// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { SessionTripSnapshot } from "@/hooks/useSessionTripStack";
import type { GeneratedItinerary } from "@/types";

const addToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => `${key}:${values?.places ?? ""}`,
}));
const capture = vi.fn();
vi.mock("@/lib/posthog/events", () => ({ capture: (...a: unknown[]) => capture(...a) }));
vi.mock("@/lib/observability/sentry", () => ({ sentryException: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
const readPendingClaim = vi.fn();
vi.mock("@/lib/trips/anonymous-claim-client", () => ({ readPendingClaim: () => readPendingClaim() }));
const findRecentTwin = vi.fn();
vi.mock("@/lib/trips/recent-twin", () => ({ findRecentTwin: (...a: unknown[]) => findRecentTwin(...a) }));
const saveTrip = vi.fn();
vi.mock("@/lib/trips/wizard-trip-writes", () => ({
  newWizardMountId: () => "m1",
  wizardTripWrites: () => ({ saveTrip: (...a: unknown[]) => saveTrip(...a), attachCoverImage: async () => {} }),
}));

import { markVisitToKeep, visitToKeep } from "@/lib/wizard/visit-trips";
import { useKeepVisitTrips } from "./useKeepVisitTrips";

type Props = Parameters<typeof useKeepVisitTrips>[0];
const trip = (id: string, destination: string, createdAt: number): SessionTripSnapshot => ({
  id,
  destination,
  startDate: "2027-05-10",
  endDate: "2027-05-13",
  dayCount: 4,
  itinerary: { destination: { name: destination }, days: [] } as unknown as GeneratedItinerary,
  pace: "moderate",
  vibes: ["cultural"],
  budgetTier: "balanced",
  createdAt,
});
const trips = [trip("rome", "Rome, Italy", 1), trip("porto", "Porto, Portugal", 2), trip("lisbon", "Lisbon, Portugal", 3)];
const props = (over: Partial<Props> = {}): Props => ({ trips, userId: "u1", currentSaved: true, locale: "en", ...over });

beforeEach(() => {
  window.sessionStorage.clear();
  [addToast, capture, readPendingClaim, findRecentTwin, saveTrip].forEach((fn) => fn.mockReset());
  readPendingClaim.mockResolvedValue(null);
  findRecentTwin.mockResolvedValue(null);
  saveTrip.mockImplementation(async () => ({ tripId: "t", durationDays: 4 }));
});

describe("useKeepVisitTrips", () => {
  it("saves the marked places once the plan on screen is saved, says which, and forgets the mark", async () => {
    markVisitToKeep(["rome", "porto"]);
    const { rerender } = renderHook((p: Props) => useKeepVisitTrips(p), { initialProps: props() });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("keptToo:Rome, Porto", "success", 6000));
    expect(saveTrip).toHaveBeenCalledTimes(2);
    expect(visitToKeep()).toEqual([]);
    expect(capture).toHaveBeenCalledWith("visit_trips_kept", { marked: 2, kept: 2 });
    rerender(props({ trips: [...trips] }));
    expect(saveTrip).toHaveBeenCalledTimes(2);
  });

  it("waits for the sign-in and the plan on screen's save, and does nothing without a mark", async () => {
    markVisitToKeep(["rome"]);
    const { rerender } = renderHook((p: Props) => useKeepVisitTrips(p), { initialProps: props({ userId: null }) });
    rerender(props({ currentSaved: false }));
    rerender(props({ trips: [] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(saveTrip).not.toHaveBeenCalled();
    rerender(props());
    await waitFor(() => expect(saveTrip).toHaveBeenCalledTimes(1));

    window.sessionStorage.clear();
    saveTrip.mockClear();
    renderHook(() => useKeepVisitTrips(props()));
    await new Promise((r) => setTimeout(r, 20));
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it("runs once, even when the page renders again while the places are being saved", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    saveTrip.mockImplementation(async () => {
      await held;
      return { tripId: "t", durationDays: 4 };
    });
    markVisitToKeep(["rome", "porto"]);
    const { rerender } = renderHook((p: Props) => useKeepVisitTrips(p), { initialProps: props() });
    await waitFor(() => expect(saveTrip).toHaveBeenCalledTimes(1));
    rerender(props({ trips: [...trips] }));
    rerender(props({ trips: [...trips] }));
    release();
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(saveTrip).toHaveBeenCalledTimes(2);
  });

  it("says nothing when every marked place was already in the account", async () => {
    findRecentTwin.mockResolvedValue({ id: "x", title: "Rome" });
    markVisitToKeep(["rome"]);
    renderHook(() => useKeepVisitTrips(props()));
    await waitFor(() => expect(capture).toHaveBeenCalledWith("visit_trips_kept", { marked: 1, kept: 0 }));
    expect(saveTrip).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });
});
